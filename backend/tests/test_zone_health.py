from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import assistant, health, main, query
from app.config import Settings
from app.db import Base
from app.models import Beacon, Event
from app.scoring import BOUNDS


NOW = datetime(2026, 11, 22, 12, tzinfo=timezone.utc)


@pytest.fixture
def database():
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as db:
        yield db
    engine.dispose()


@pytest.fixture
def settings():
    return Settings(_env_file=None, aci_baseline=1, heartbeat_timeout_seconds=45,
                    event_threshold=0.45, assistant_enabled=False, gemini_api_key=None)


def beacon(db, name, zone_index):
    row, col = divmod(zone_index, 4)
    item = Beacon(beacon_id=name,
        latitude=BOUNDS['min_lat'] + (row + 0.5) * (BOUNDS['max_lat'] - BOUNDS['min_lat']) / 4,
        longitude=BOUNDS['min_lon'] + (col + 0.5) * (BOUNDS['max_lon'] - BOUNDS['min_lon']) / 4,
        is_real_hardware=False)
    db.add(item)
    db.flush()
    return item


def event(db, name, aci=1, score=0, age=0):
    item = Event(beacon_id=name, timestamp=NOW - timedelta(seconds=age),
        sound_class='Chainsaw' if score else 'Bird', confidence=1, threat_score=score,
        aci_value=aci, final_score=score, signal_strength=1, is_confirmed=False)
    db.add(item)
    db.flush()
    return item


def eight_zones(db, affected=0):
    for i in range(8):
        beacon(db, f'B{i}', i)
        event(db, f'B{i}', score=1 if i < affected else 0)
    db.commit()


@pytest.mark.parametrize('affected', [0, 1, 2, 8])
def test_penalties_scale_with_affected_zones(database, settings, affected):
    eight_zones(database, affected)
    summary = health.get_forest_summary(database, settings, now=NOW)
    assert summary['forest_health_score'] == round(100 - 35 * affected / 8, 1)
    assert summary['active_threat_penalty'] == round(35 * affected / 8, 1)
    assert summary['affected_zone_count'] == affected
    assert summary['observed_zone_count'] == summary['populated_zone_count'] == 8
    assert summary['total_zone_count'] == 16
    assert summary['zones'][0]['health_score'] == (65 if affected else 100)


def test_duplicate_beacons_do_not_duplicate_a_zone_penalty(database, settings):
    eight_zones(database, 1)
    beacon(database, 'EXTRA', 0)
    event(database, 'EXTRA', score=1)
    database.commit()
    summary = health.get_forest_summary(database, settings, now=NOW)
    assert summary['forest_health_score'] == 95.6
    assert summary['affected_zone_count'] == 1
    assert summary['active_threat_count'] == 2
    assert summary['zones'][0]['reporting_beacon_count'] == 2


def test_dense_zones_do_not_have_extra_weight(database, settings):
    for i in range(10):
        beacon(database, f'DENSE{i}', 0)
        event(database, f'DENSE{i}', aci=1)
    beacon(database, 'SPARSE', 1)
    event(database, 'SPARSE', aci=0)
    database.commit()
    summary = health.get_forest_summary(database, settings, now=NOW)
    assert summary['forest_health_score'] == summary['aci_health_score'] == 50
    assert summary['average_aci'] == summary['live_average_aci'] == 0.5
    assert summary['observed_zone_count'] == 2


def test_unobserved_and_empty_zones_are_not_counted_as_healthy(database, settings):
    for i in range(8):
        beacon(database, f'B{i}', i)
    event(database, 'B0', aci=0.6, score=0.8)
    event(database, 'B1', age=301)
    database.commit()
    summary = health.get_forest_summary(database, settings, now=NOW)
    assert summary['forest_health_score'] == 32
    assert summary['observed_zone_count'] == 1
    assert summary['populated_zone_count'] == 8
    assert summary['zones'][1]['health_score'] is None
    assert summary['zones'][1]['configured_beacon_count'] == 1
    assert summary['zones'][8]['health_score'] is None
    assert summary['zones'][8]['configured_beacon_count'] == 0


def test_no_recent_audio_is_not_a_zero_or_perfect_score(database, settings):
    beacon(database, 'B0', 0)
    event(database, 'B0', age=301)
    database.commit()
    summary = health.get_forest_summary(database, settings, now=NOW)
    for key in ('forest_health_score', 'aci_health_score', 'live_average_aci', 'average_aci'):
        assert summary[key] is None
    assert summary['observed_zone_count'] == 0
    assert summary['populated_zone_count'] == 1
    assert summary['active_threat_count'] == 0


def test_new_normal_reading_and_id_tie_break_clear_previous_threat(database, settings):
    beacon(database, 'B0', 0)
    event(database, 'B0', score=1, age=1)
    event(database, 'B0', score=1)
    event(database, 'B0', score=0)
    database.commit()
    summary = health.get_forest_summary(database, settings, now=NOW)
    assert summary['forest_health_score'] == 100
    assert summary['affected_zone_count'] == 0
    assert summary['active_threat_count'] == 0


def test_health_window_and_threat_window_have_distinct_boundaries(database, settings):
    beacon(database, 'B0', 0)
    event(database, 'B0', aci=0.8, score=1, age=46)
    database.commit()
    summary = health.get_forest_summary(database, settings, now=NOW)
    assert summary['forest_health_score'] == 80
    assert summary['observed_zone_count'] == 1
    assert summary['active_threat_count'] == 0
    assert health.get_forest_summary(database, settings, now=NOW + timedelta(seconds=255))['forest_health_score'] is None


def test_acoustic_normalization_is_clamped_per_beacon(database, settings):
    settings.aci_baseline = 0.5
    beacon(database, 'B0', 0)
    beacon(database, 'B1', 0)
    event(database, 'B0', aci=0.75)
    event(database, 'B1', aci=0)
    database.commit()
    summary = health.get_forest_summary(database, settings, now=NOW)
    assert summary['forest_health_score'] == 50
    assert summary['live_average_aci'] == 0.375


def test_penalty_reports_effective_percentage_points_after_clamping(database, settings):
    beacon(database, 'B0', 0)
    beacon(database, 'B1', 1)
    event(database, 'B0', aci=0.1, score=1)
    event(database, 'B1', aci=0.7)
    database.commit()
    summary = health.get_forest_summary(database, settings, now=NOW)
    assert summary['forest_health_score'] == 35
    assert summary['aci_health_score'] == 40
    assert summary['active_threat_penalty'] == 5
    assert summary['zones'][0]['active_threat_penalty'] == 10


@pytest.mark.parametrize('has_audio', [False, True])
def test_api_and_assistant_share_scores_and_coverage(database, settings, monkeypatch, has_audio):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW
    monkeypatch.setattr(main, 'datetime', Clock)
    monkeypatch.setattr(health, 'datetime', Clock)
    monkeypatch.setattr(main, 'settings', settings)
    if has_audio:
        eight_zones(database, 1)
    else:
        beacon(database, 'B0', 0)
        database.commit()
    api = main.summary(database)
    assert query.get_forest_summary(database, settings) == api
    assert assistant._safe_tool('get_forest_summary', {}, database, settings) == api
    response = assistant.answer_query('forest health', database, settings)
    assert response.context['forest_health_score'] == api['forest_health_score']
    assert response.context['observed_zone_count'] == api['observed_zone_count']
    if has_audio:
        assert '95.6%' in response.answer
        assert '1 of 8 observed zones' in response.answer
    else:
        assert 'waiting for recent audio' in response.answer
        assert 'None%' not in response.answer
        assert '100%' not in response.answer
