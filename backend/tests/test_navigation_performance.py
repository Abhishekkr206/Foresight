import asyncio
from datetime import datetime, timedelta, timezone
import threading
import time
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings
from app.db import Base
from app.models import Beacon, Event
from app.simulation import Simulator
from app import main


@pytest.fixture
def database():
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        db.add(Beacon(beacon_id='TEST', latitude=-4, longitude=-55, is_real_hardware=False))
        db.commit()
    yield factory
    engine.dispose()


def add_event(db, timestamp, score=0, aci=0.8, confirmed=False):
    record = Event(beacon_id='TEST', timestamp=timestamp, sound_class='Noise', confidence=0.9,
                   threat_score=score, aci_value=aci, final_score=score, signal_strength=0.9,
                   is_confirmed=confirmed)
    db.add(record)
    db.commit()
    return record


def test_summary_empty_and_historical_defaults(database):
    with database() as db:
        result = main.summary(db)
        assert result['forest_health_score'] is None
        assert result['aci_health_score'] is None
        assert result['observed_zone_count'] == 0
        assert result['historical_average_aci'] == main.settings.aci_baseline
        add_event(db, datetime.now(timezone.utc) - timedelta(days=2), 0.9, 0.2, True)
        result = main.summary(db)
        assert result['active_threat_count'] == 0
        assert result['confirmed_events_today'] == 0
        assert result['average_aci'] is None
        assert result['historical_average_aci'] == pytest.approx(0.2)


def test_summary_latest_event_wins_timestamp_ties(database):
    now = datetime.now(timezone.utc)
    with database() as db:
        add_event(db, now - timedelta(seconds=5), 0.9, 0.2, True)
        add_event(db, now, 0.8, 0.3)
        add_event(db, now, 0, 0.8)
        result = main.summary(db)
        assert result['active_threat_count'] == 0
        assert result['active_threat_penalty'] == 0
        assert result['live_average_aci'] == pytest.approx(0.8)
        assert result['confirmed_events_today'] == 1
        assert result['historical_average_aci'] == pytest.approx((0.2 + 0.3 + 0.8) / 3)


def test_summary_utc_midnight(database, monkeypatch):
    now = datetime(2026, 11, 21, 0, 0, 10, tzinfo=timezone.utc)
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now
    monkeypatch.setattr(main, 'datetime', Clock)
    with database() as db:
        midnight = now.replace(hour=0, minute=0, second=0)
        add_event(db, midnight - timedelta(microseconds=1), confirmed=True)
        add_event(db, midnight, confirmed=True)
        assert main.summary(db)['confirmed_events_today'] == 1


@pytest.mark.parametrize('age,expected', [(44, 1), (45, 1), (46, 0)])
def test_summary_active_threat_timeout(database, monkeypatch, age, expected):
    now = datetime(2026, 11, 21, 12, tzinfo=timezone.utc)
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now
    monkeypatch.setattr(main, 'datetime', Clock)
    monkeypatch.setattr(main.settings, 'heartbeat_timeout_seconds', 45)
    with database() as db:
        add_event(db, now - timedelta(seconds=age), score=0.9)
        assert main.summary(db)['active_threat_count'] == expected


def test_summary_large_history(database):
    now = datetime.now(timezone.utc)
    with database() as db:
        batch = [dict(beacon_id='TEST', timestamp=now - timedelta(days=2), sound_class='Noise',
                      confidence=0.9, threat_score=0, aci_value=0.5, final_score=0,
                      signal_strength=0.9, is_confirmed=False) for _ in range(100000)]
        db.execute(Event.__table__.insert(), batch)
        db.commit()
        add_event(db, now, aci=0.9)
        times = []
        for _ in range(5):
            start = time.perf_counter()
            result = main.summary(db)
            times.append(round((time.perf_counter() - start) * 1000, 2))
        print(f'summary_100k_ms={times}')
        assert result['live_average_aci'] == pytest.approx(0.9)
        assert result['historical_average_aci'] == pytest.approx((100000 * 0.5 + 0.9) / 100001)


def test_slow_worker_keeps_health_responsive_and_stop_waits(database):
    entered, release = threading.Event(), threading.Event()
    threads = []
    def process(db, beacon, *args, **kwargs):
        threads.append(threading.get_ident())
        entered.set()
        assert release.wait(5)
        return SimpleNamespace(timestamp=datetime.now(timezone.utc))
    async def scenario():
        session_threads = []
        def db_factory():
            session_threads.append(threading.get_ident())
            return database()
        simulator = Simulator(Settings(), db_factory, SimpleNamespace(process=process))
        main_thread = threading.get_ident()
        simulator.start()
        task = simulator.task
        try:
            for _ in range(500):
                if entered.is_set():
                    break
                await asyncio.sleep(0.002)
            assert entered.is_set()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url='http://test') as client:
                assert (await asyncio.wait_for(client.get('/health'), 1)).status_code == 200
            stop = asyncio.create_task(simulator.stop())
            await asyncio.sleep(0)
            simulator.start()
            assert simulator.task is task
            assert not stop.done()
            release.set()
            await asyncio.wait_for(stop, 2)
            assert simulator.task is None
            assert threads[0] != main_thread
            assert session_threads and all(thread != main_thread for thread in session_threads)
            simulator.start()
            assert simulator.task is not task
        finally:
            release.set()
            await simulator.stop()
    asyncio.run(scenario())


def test_worker_failure_does_not_skip_next_beacon(database, monkeypatch):
    async def scenario():
        simulator = Simulator(Settings(), database, None)
        calls = []
        monkeypatch.setattr(simulator, '_beacon_locations', lambda: [('BAD', -4, -55), ('GOOD', -4, -55)])
        def process(beacon_id, zone, sound, scenario=None):
            calls.append(beacon_id)
            if beacon_id == 'BAD':
                raise ValueError('test failure')
            return datetime.now(timezone.utc)
        monkeypatch.setattr(simulator, '_process_beacon', process)
        simulator.start()
        for _ in range(500):
            if simulator.last_cycle_at:
                break
            await asyncio.sleep(0.002)
        await simulator.stop()
        assert calls == ['BAD', 'GOOD']
        assert 'test failure' in simulator.last_error
        assert simulator.last_event_at is not None
    asyncio.run(scenario())
