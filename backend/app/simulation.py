import asyncio
from collections import OrderedDict, deque
import logging
import random
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select

from .audio import decode_audio, make_demo_wav
from .config import Settings
from .models import Beacon, BeaconStatus
from .scoring import BOUNDS, get_zone

THREAT_SOUNDS = ("chainsaw", "gunshot", "vehicle", "engine", "chopping")
TEST_SOUNDS = ("birds", "frogs", "insects", "rain", "wind", "monkey")
ALL_SIMULATION_SOUNDS = ("ambient",) + THREAT_SOUNDS + TEST_SOUNDS
logger = logging.getLogger(__name__)


class Simulator:
    def __init__(self, settings: Settings, db_factory, pipeline):
        self.settings, self.db_factory, self.pipeline = settings, db_factory, pipeline
        self.running = False
        self.worker_phase = "stopped"
        self.task = None
        self._work_event = asyncio.Event()
        self.scenarios = {}
        self.pending = OrderedDict()
        self._expiry_timers = {}
        self._locations = None
        self.batteries = {}
        self.last_cycle_at = self.last_event_at = self.last_error = None

    def zone_for(self, lat, lon):
        return get_zone(lat, lon, BOUNDS, self.settings.grid_size)

    def start(self):
        if self.task is not None and not self.task.done():
            return
        self.running = True
        self.worker_phase = "initializing"
        self.last_error = None
        self._work_event.clear()
        self.task = asyncio.create_task(self._loop())

    async def stop(self):
        self.running = False
        self.worker_phase = "stopping" if self.task and not self.task.done() else "stopped"
        self._work_event.set()
        for timer in self._expiry_timers.values():
            timer.cancel()
        self._expiry_timers.clear()
        self.scenarios.clear()
        self.pending.clear()
        self._publish()
        task = self.task
        if task:
            await asyncio.shield(task)
            if self.task is task:
                self.task = None
        self.worker_phase = "stopped"
        self._publish()

    def trigger(self, zone, sound, duration, locations=None):
        sound = sound.strip().lower()
        if sound not in ALL_SIMULATION_SOUNDS:
            raise ValueError(f"unsupported simulation sound: {sound}")
        if not self.running or self.worker_phase == "stopping":
            raise ValueError("Start the simulation before triggering a sound")
        if locations is not None:
            self._locations = locations
        ids = sorted(item[0] for item in (self._locations or []) if self.zone_for(item[1], item[2]) == zone)
        if not ids:
            raise ValueError("This zone has no simulated beacons")
        timer = self._expiry_timers.pop(zone, None)
        if timer:
            timer.cancel()
        scenario = dict(scenario_id=uuid4().hex, zone=zone, sound=sound,
                        duration_seconds=duration, beacon_ids=ids, state="queued",
                        started_at=None, expires_at=None)
        self.scenarios[zone] = scenario
        self.pending[zone] = scenario['scenario_id']
        self._work_event.set()
        return dict(scenario)

    def _publish(self):
        broadcaster = getattr(self.pipeline, 'broadcaster', None)
        if broadcaster:
            broadcaster({'type': 'simulation.status', 'data': self.status()})

    def _activate(self, scenario):
        if scenario['state'] != 'queued':
            return
        now = datetime.now(timezone.utc)
        scenario.update(state='processing', started_at=now)
        if scenario['sound'] != 'ambient':
            scenario['expires_at'] = now + timedelta(seconds=scenario['duration_seconds'])
            self._expiry_timers[scenario['zone']] = asyncio.get_running_loop().call_later(
                scenario['duration_seconds'], self._expire, scenario['zone'], scenario['scenario_id'])
        self._publish()

    def _expire(self, zone, scenario_id):
        current = self.scenarios.get(zone)
        if current and current['scenario_id'] == scenario_id:
            self.scenarios.pop(zone)
            self._expiry_timers.pop(zone, None)
            self.pending[zone] = None
            self._work_event.set()
            self._publish()

    def available_threat_sounds(self):
        return [sound for sound in THREAT_SOUNDS if (self.settings.simulation_threat_audio_dir / f'{sound}.wav').is_file()]

    def available_test_sounds(self):
        return [sound for sound in TEST_SOUNDS if (self.settings.simulation_test_audio_dir / f'{sound}.wav').is_file()]

    def status(self):
        locations = self._locations if self._locations is not None else self._beacon_locations()
        now = datetime.now(timezone.utc)
        zones = {}
        for row in range(self.settings.grid_size):
            for col in range(self.settings.grid_size):
                zone = f'zone_{row}_{col}'
                ids = sorted(item[0] for item in locations if self.zone_for(item[1], item[2]) == zone)
                scenario = self.scenarios.get(zone, {})
                expires = scenario.get('expires_at')
                sound = scenario.get('sound', 'ambient')
                zones[zone] = dict(sound=sound, threat=sound in THREAT_SOUNDS,
                    beacon_count=len(ids), beacon_ids=ids,
                    remaining_seconds=max(0, round((expires - now).total_seconds(), 1)) if expires else 0,
                    scenario_id=scenario.get('scenario_id'), phase=scenario.get('state', 'idle'),
                    started_at=scenario.get('started_at'), expires_at=expires)
        return dict(running=self.running, worker_healthy=bool(self.running and self.task and not self.task.done()),
            worker_phase=self.worker_phase, last_cycle_at=self.last_cycle_at, last_event_at=self.last_event_at,
            last_error=self.last_error, zones=zones, available_threat_sounds=self.available_threat_sounds(),
            available_test_sounds=self.available_test_sounds())

    def _beacon_locations(self):
        with self.db_factory() as db:
            return [(beacon.beacon_id, beacon.latitude, beacon.longitude)
                    for beacon in db.scalars(select(Beacon).where(Beacon.is_real_hardware.is_(False))).all()]

    def _process_beacon(self, beacon_id, zone, sound, scenario=None):
        # Sessions and ORM objects stay entirely inside the worker thread.
        with self.db_factory() as db:
            beacon = db.scalar(select(Beacon).where(Beacon.beacon_id == beacon_id))
            if beacon is None:
                return None
            ambient_path = self.settings.simulation_audio_dir / "ambient.wav"
            threat_path = self.settings.simulation_threat_audio_dir / f"{sound}.wav"
            test_path = self.settings.simulation_test_audio_dir / f"{sound}.wav"
            if sound == "ambient" and ambient_path.is_file():
                data, filename = ambient_path.read_bytes(), ambient_path.name
            elif sound in THREAT_SOUNDS and threat_path.is_file():
                candidate = threat_path.read_bytes()
                try:
                    decode_audio(candidate)
                except Exception:
                    logger.warning("Invalid threat audio %s; using generated fallback", threat_path)
                    data, filename = make_demo_wav(sound), f"{zone}_{sound}.wav"
                else:
                    data, filename = candidate, threat_path.name
            elif sound in TEST_SOUNDS and test_path.is_file():
                candidate = test_path.read_bytes()
                try:
                    decode_audio(candidate)
                except Exception:
                    logger.warning("Invalid test audio %s; using generated fallback", test_path)
                    data, filename = make_demo_wav(sound), f"{zone}_{sound}.wav"
                else:
                    data, filename = candidate, test_path.name
            else:
                data, filename = make_demo_wav(sound), f"{zone}_{sound}.wav"

            event = self.pipeline.process(
                db,
                beacon,
                data,
                filename,
                "audio/wav",
                classification_hint=None if sound == "ambient" else sound,
                zone=zone,
                scenario=scenario,
            )
            timestamp = event.timestamp
            battery = self.batteries.get(beacon.beacon_id, random.uniform(72, 96))
            battery = max(5.0, battery - 0.02)
            self.batteries[beacon.beacon_id] = battery
            status = db.scalar(
                select(BeaconStatus).where(BeaconStatus.beacon_id == beacon.beacon_id)
            )
            if status is None:
                db.add(
                    BeaconStatus(
                        beacon_id=beacon.beacon_id,
                        last_seen=datetime.now(timezone.utc),
                        battery_percentage=battery,
                    )
                )
            else:
                status.last_seen = datetime.now(timezone.utc)
                status.battery_percentage = battery
            db.commit()
            return timestamp

    async def _loop(self):
        priority, regular = deque(), deque()
        next_cycle = 0
        try:
            self._locations = await asyncio.to_thread(self._beacon_locations)
            warmup = getattr(self.pipeline, 'warmup', None)
            if warmup and self.running:
                await asyncio.to_thread(warmup)
            if self.running:
                self.worker_phase = 'ready'
                self._publish()
            while self.running:
                regular_job = False
                if self.pending:
                    zone, scenario_id = self.pending.popitem(last=False)
                    scenario = self.scenarios.get(zone)
                    if scenario_id is not None and (not scenario or scenario['scenario_id'] != scenario_id):
                        continue
                    if scenario:
                        self._activate(scenario)
                    jobs = [(item[0], zone, dict(scenario) if scenario else None)
                            for item in self._locations if self.zone_for(item[1], item[2]) == zone]
                    priority.extendleft(reversed(jobs))
                if priority:
                    beacon_id, zone, scenario = priority.popleft()
                    if (scenario or {}).get('scenario_id') != (self.scenarios.get(zone) or {}).get('scenario_id'):
                        continue
                elif regular:
                    regular_job = True
                    beacon_id, latitude, longitude = regular.popleft()
                    zone = self.zone_for(latitude, longitude)
                    scenario = self.scenarios.get(zone)
                    scenario = dict(scenario) if scenario else None
                else:
                    now = asyncio.get_running_loop().time()
                    if now >= next_cycle:
                        regular.extend(self._locations)
                        next_cycle = now + 10
                        if regular:
                            continue
                    self._work_event.clear()
                    if self.pending or not self.running:
                        continue
                    try:
                        await asyncio.wait_for(self._work_event.wait(), max(0.01, next_cycle - now))
                    except asyncio.TimeoutError:
                        pass
                    continue
                sound = scenario['sound'] if scenario else 'ambient'
                try:
                    timestamp = await asyncio.to_thread(self._process_beacon, beacon_id, zone, sound, scenario)
                    if timestamp is not None:
                        self.last_event_at = timestamp
                    current = self.scenarios.get(zone)
                    if timestamp is not None and current and current['scenario_id'] == (scenario or {}).get('scenario_id'):
                        current['state'] = 'detected'
                        self._publish()
                except Exception as exc:
                    self.last_error = f'{beacon_id}: {exc}'
                    current = self.scenarios.get(zone)
                    if current and current['scenario_id'] == (scenario or {}).get('scenario_id'):
                        current['state'] = 'failed'
                    logger.exception('Simulation processing failed for %s', beacon_id)
                    self._publish()
                finally:
                    if regular_job and not regular:
                        self.last_cycle_at = datetime.now(timezone.utc)
        except Exception as exc:
            self.last_error = str(exc)
            logger.exception('Simulation worker failed')
        finally:
            self.worker_phase = 'stopped'
            self.running = False
            self._publish()
