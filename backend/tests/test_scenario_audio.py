import asyncio
from datetime import datetime, timezone
import threading
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import main, pipeline as pipeline_module
from app.audio import make_demo_wav
from app.config import Settings
from app.db import Base
from app.models import Beacon, Event
from app.pipeline import Pipeline
from app.simulation import Simulator
from app.storage import AudioStorage


@pytest.fixture
def capture_setup(tmp_path, monkeypatch):
    settings = Settings(_env_file=None, uploads_dir=tmp_path / 'uploads',
                        supabase_url=None, supabase_service_role_key=None)
    engine = create_engine('sqlite:///' + (tmp_path / 'captures.db').as_posix(),
                           connect_args={'check_same_thread': False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        db.add(Beacon(beacon_id='TEST', latitude=-4, longitude=-55, is_real_hardware=False))
        db.commit()
    messages = []
    storage = AudioStorage(settings)
    pipeline = Pipeline(settings, storage, messages.append)
    monkeypatch.setattr(pipeline_module, 'classify', lambda *args, **kwargs: {'Chainsaw': 0.99})
    monkeypatch.setattr(pipeline_module, 'classifier_status', lambda: {'classifier': 'test'})
    yield pipeline, storage, factory, messages
    storage.stop_uploader()
    engine.dispose()


def test_audio_is_ready_before_classification_and_capture_url_is_versioned(capture_setup, monkeypatch, sign_in):
    pipeline, storage, factory, messages = capture_setup
    checked = []
    def classify(*args, **kwargs):
        assert messages[0]['type'] == 'audio.ready'
        assert pipeline.latest_audio('TEST')['capture_id'] == messages[0]['data']['capture_id']
        checked.append(True)
        return {'Chainsaw': 0.99}
    monkeypatch.setattr(pipeline_module, 'classify', classify)
    data = make_demo_wav('chainsaw')
    with factory() as db:
        beacon = db.query(Beacon).first()
        pipeline.process(db, beacon, data, 'test.wav', 'audio/wav', 'chainsaw', 'zone_2_2',
                         {'scenario_id': 'scenario-one', 'expires_at': None})
    assert checked
    assert messages[-1]['type'] == 'event.created'
    assert messages[-1]['scenario_id'] == 'scenario-one'
    first = pipeline.latest_audio('TEST')['capture_id']
    monkeypatch.setattr(main, 'pipeline', pipeline)
    monkeypatch.setattr(main, 'storage', storage)
    monkeypatch.setattr(main, 'engine', factory.kw['bind'])
    monkeypatch.setattr(main, 'SessionLocal', factory)
    monkeypatch.setattr(main.app.state, 'simulator', Simulator(main.settings, factory, pipeline))
    monkeypatch.setattr(main.settings, 'enable_simulation', False)
    with TestClient(main.app) as client:
        sign_in(client)
        meta = client.get('/api/debug/audio/latest/meta?beacon_id=TEST').json()
        assert meta['scenario_id'] == 'scenario-one'
        assert meta['received_at'].endswith('+00:00')
        assert client.get(f'/api/debug/audio/latest?beacon_id=TEST&capture_id={first}').content == data
        assert client.get('/api/debug/audio/latest?beacon_id=TEST&capture_id=old').status_code == 409
        assert client.get('/api/debug/audio/latest?beacon_id=TEST').status_code == 200


async def until(predicate, timeout=2):
    start = time.monotonic()
    while not predicate():
        if time.monotonic() - start > timeout:
            raise AssertionError('worker did not reach the expected state')
        await asyncio.sleep(0.005)


def test_trigger_wakes_worker_expires_exactly_and_resets_to_ambient(monkeypatch):
    async def scenario():
        records = []
        simulator = Simulator(Settings(_env_file=None), None, None)
        locations = [('B', -4, -55)]
        monkeypatch.setattr(simulator, '_beacon_locations', lambda: locations)
        def process(beacon_id, zone, sound, scenario=None):
            records.append((sound, (scenario or {}).get('scenario_id'), time.monotonic()))
            return datetime.now(timezone.utc)
        monkeypatch.setattr(simulator, '_process_beacon', process)
        simulator.start()
        try:
            await until(lambda: len(records) == 1)
            zone = simulator.zone_for(-4, -55)
            started = time.monotonic()
            accepted = simulator.trigger(zone, 'chainsaw', 0.2)
            await until(lambda: len(records) >= 2)
            assert records[1][0:2] == ('chainsaw', accepted['scenario_id'])
            assert records[1][2] - started < 0.5
            active = simulator.status()['zones'][zone]
            assert (active['expires_at'] - active['started_at']).total_seconds() == pytest.approx(0.2)
            await until(lambda: len(records) >= 3)
            assert records[2][0] == 'ambient'
            assert simulator.status()['zones'][zone]['phase'] == 'idle'
            reset = simulator.trigger(zone, 'ambient', 10)
            await until(lambda: any(item[1] == reset['scenario_id'] for item in records))
            with pytest.raises(ValueError, match='no simulated beacons'):
                simulator.trigger('zone_0_0', 'chainsaw', 10)
        finally:
            await simulator.stop()
        with pytest.raises(ValueError, match='Start the simulation'):
            simulator.trigger(zone, 'chainsaw', 10)
    asyncio.run(scenario())


def test_queued_duration_does_not_elapse_during_warmup_and_newest_trigger_wins(monkeypatch):
    async def scenario():
        gate = threading.Event()
        pipeline = SimpleNamespace(warmup=lambda: gate.wait(2))
        simulator = Simulator(Settings(_env_file=None), None, pipeline)
        monkeypatch.setattr(simulator, '_beacon_locations', lambda: [('B', -4, -55)])
        calls = []
        monkeypatch.setattr(simulator, '_process_beacon', lambda beacon, zone, sound, scenario=None:
                            calls.append((sound, (scenario or {}).get('scenario_id'))) or datetime.now(timezone.utc))
        simulator.start()
        try:
            await until(lambda: simulator._locations is not None)
            zone = simulator.zone_for(-4, -55)
            old = simulator.trigger(zone, 'chainsaw', 0.1)
            new = simulator.trigger(zone, 'gunshot', 0.1)
            await asyncio.sleep(0.15)
            queued = simulator.status()['zones'][zone]
            assert queued['started_at'] is None
            assert queued['phase'] == 'queued'
            gate.set()
            await until(lambda: bool(calls))
            assert calls[0] == ('gunshot', new['scenario_id'])
            assert all(item[1] != old['scenario_id'] for item in calls)
        finally:
            gate.set()
            await simulator.stop()
    asyncio.run(scenario())


def test_slow_cloud_upload_does_not_delay_local_event_or_audio(capture_setup):
    pipeline, storage, factory, messages = capture_setup
    gate, entered = threading.Event(), threading.Event()
    def upload(*args, **kwargs):
        entered.set()
        gate.wait(3)
    bucket = SimpleNamespace(upload=upload, get_public_url=lambda name: 'https://storage.test/' + name)
    storage.supabase = SimpleNamespace(storage=SimpleNamespace(from_=lambda name: bucket))
    storage.start_uploader(factory, messages.append)
    try:
        start = time.monotonic()
        with factory() as db:
            event = pipeline.process(db, db.query(Beacon).first(), make_demo_wav('chainsaw'), 'sound.wav', 'audio/wav')
            event_id = event.id
            assert event.audio_file_url.startswith('/uploads/')
        assert time.monotonic() - start < 1
        assert entered.wait(1)
        assert messages[0]['type'] == 'audio.ready'
        assert any(message['type'] == 'event.created' for message in messages)
        for i in range(32):
            assert storage.queue_upload(event_id, b'data', f'{i}.wav', 'audio/wav')
        assert not storage.queue_upload(event_id, b'data', 'overflow.wav', 'audio/wav')
        gate.set()
        for _ in range(200):
            if any(message['type'] == 'event.updated' for message in messages):
                break
            time.sleep(0.005)
        assert any(message['type'] == 'event.updated' for message in messages)
    finally:
        gate.set()
        storage.stop_uploader()


def test_failed_cloud_upload_retains_local_url(capture_setup):
    pipeline, storage, factory, messages = capture_setup
    def fail(*args, **kwargs):
        raise RuntimeError('offline')
    bucket = SimpleNamespace(upload=fail)
    storage.supabase = SimpleNamespace(storage=SimpleNamespace(from_=lambda name: bucket))
    storage.start_uploader(factory, messages.append)
    with factory() as db:
        record = pipeline.process(db, db.query(Beacon).first(), make_demo_wav('chainsaw'), 'sound.wav', 'audio/wav')
        event_id = record.id
    storage._queue.join()
    with factory() as db:
        assert db.get(Event, event_id).audio_file_url.startswith('/uploads/')
    assert not any(message['type'] == 'event.updated' for message in messages)


def test_finishing_an_old_capture_cannot_overwrite_new_capture_metadata(capture_setup, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    pipeline, storage, factory, messages = capture_setup
    entered, release = threading.Event(), threading.Event()
    def classify(*args, **kwargs):
        if not entered.is_set():
            entered.set()
            assert release.wait(3)
            return {'Wind': 0.99}
        return {'Chainsaw': 0.99}
    monkeypatch.setattr(pipeline_module, 'classify', classify)
    def capture():
        with factory() as db:
            return pipeline.process(db, db.query(Beacon).first(), make_demo_wav('chainsaw'), 'sound.wav', 'audio/wav')
    with ThreadPoolExecutor(max_workers=1) as executor:
        old = executor.submit(capture)
        try:
            assert entered.wait(1)
            capture()
            newest = pipeline.latest_audio('TEST')['capture_id']
        finally:
            release.set()
        old.result(timeout=3)
    latest = pipeline.latest_audio('TEST')
    assert latest['capture_id'] == newest
    assert latest['sound_class'] == 'Chainsaw'


def test_trigger_api_rejects_unavailable_targets_and_acknowledges_ambient(capture_setup, monkeypatch, sign_in):
    pipeline, storage, factory, messages = capture_setup
    monkeypatch.setattr(main, 'pipeline', pipeline)
    monkeypatch.setattr(main, 'storage', storage)
    monkeypatch.setattr(main, 'engine', factory.kw['bind'])
    monkeypatch.setattr(main, 'SessionLocal', factory)
    monkeypatch.setattr(main.app.state, 'simulator', Simulator(main.settings, factory, pipeline))
    monkeypatch.setattr(main.settings, 'enable_simulation', False)
    with TestClient(main.app) as client:
        sign_in(client)
        monkeypatch.setattr(main.settings, 'enable_simulation', True)
        payload = {'zone': 'zone_0_0', 'sound': 'chainsaw', 'duration_seconds': 10}
        stopped = client.post('/api/simulation/trigger', json=payload)
        assert stopped.status_code == 400
        assert 'Start the simulation' in stopped.json()['detail']
        assert client.post('/api/simulation/start').status_code == 200
        empty = client.post('/api/simulation/trigger', json={**payload, 'zone': 'zone_0_1'})
        assert empty.status_code == 400
        assert 'no simulated beacons' in empty.json()['detail']
        response = client.post('/api/simulation/trigger', json={**payload, 'sound': 'ambient'})
        assert response.status_code == 200
        ack = response.json()['accepted_scenario']
        assert ack['sound'] == 'ambient'
        assert ack['state'] == 'queued'
        assert ack['beacon_ids'] == ['BEACON_07']
        assert ack['scenario_id']
