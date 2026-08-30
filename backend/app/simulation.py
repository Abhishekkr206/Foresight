import asyncio
import logging
import random
from datetime import datetime, timezone

from sqlalchemy import select

from .audio import decode_audio, make_demo_wav
from .config import Settings
from .models import Beacon, BeaconStatus
from .scoring import get_zone


BOUNDS = {"min_lat": -4.15, "max_lat": -3.85, "min_lon": -55.20, "max_lon": -54.90}
THREAT_SOUNDS = ("chainsaw", "gunshot", "vehicle", "engine", "chopping")
TEST_SOUNDS = ("birds", "frogs", "insects", "rain", "wind", "monkey")
ALL_SIMULATION_SOUNDS = THREAT_SOUNDS + TEST_SOUNDS
logger = logging.getLogger(__name__)


class Simulator:
    def __init__(self, settings: Settings, db_factory, pipeline):
        self.settings = settings
        self.db_factory = db_factory
        self.pipeline = pipeline
        self.running = False
        self.task: asyncio.Task | None = None
        self.overrides: dict[str, tuple[str, float]] = {}
        self.batteries: dict[str, float] = {}
        self.last_cycle_at: datetime | None = None
        self.last_event_at: datetime | None = None
        self.last_error: str | None = None

    def zone_for(self, lat: float, lon: float) -> str:
        return get_zone(lat, lon, BOUNDS, self.settings.grid_size)

    def start(self):
        if not self.running or self.task is None or self.task.done():
            self.running = True
            self.last_error = None
            self.task = asyncio.create_task(self._loop())

    async def stop(self):
        self.running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None

    def trigger(self, zone: str, sound: str, duration: float):
        normalized_sound = sound.strip().lower()
        if normalized_sound not in ALL_SIMULATION_SOUNDS:
            raise ValueError(f"unsupported simulation sound: {sound}")
        # The worker polls every ten seconds. Keep a short trigger alive long
        # enough to be consumed even when it is submitted just after a poll.
        self.overrides[zone] = (
            normalized_sound,
            datetime.now(timezone.utc).timestamp() + max(duration, 12.0),
        )

    def available_threat_sounds(self) -> list[str]:
        return [
            sound
            for sound in THREAT_SOUNDS
            if (self.settings.simulation_threat_audio_dir / f"{sound}.wav").is_file()
        ]

    def available_test_sounds(self) -> list[str]:
        return [
            sound
            for sound in TEST_SOUNDS
            if (self.settings.simulation_test_audio_dir / f"{sound}.wav").is_file()
        ]

    def status(self) -> dict:
        now = datetime.now(timezone.utc).timestamp()
        beacon_counts = {}
        db = self.db_factory()
        try:
            for beacon in db.scalars(select(Beacon).where(Beacon.is_real_hardware.is_(False))).all():
                zone = self.zone_for(beacon.latitude, beacon.longitude)
                beacon_counts[zone] = beacon_counts.get(zone, 0) + 1
        finally:
            db.close()
        zones = {}
        for row in range(self.settings.grid_size):
            for col in range(self.settings.grid_size):
                zone = f"zone_{row}_{col}"
                sound, until = self.overrides.get(zone, ("ambient", 0))
                if until and until <= now:
                    self.overrides.pop(zone, None)
                    sound, until = "ambient", 0
                zones[zone] = {
                    "sound": sound,
                    "threat": sound in THREAT_SOUNDS,
                    "beacon_count": beacon_counts.get(zone, 0),
                    "remaining_seconds": max(0, round(until - now, 1)) if until else 0,
                }
        return {
            "running": self.running,
            "worker_healthy": bool(self.running and self.task and not self.task.done()),
            "last_cycle_at": self.last_cycle_at,
            "last_event_at": self.last_event_at,
            "last_error": self.last_error,
            "zones": zones,
            "available_threat_sounds": self.available_threat_sounds(),
            "available_test_sounds": self.available_test_sounds(),
        }

    async def _loop(self):
        while self.running:
            db = self.db_factory()
            try:
                for beacon in db.scalars(
                    select(Beacon).where(Beacon.is_real_hardware.is_(False))
                ).all():
                    try:
                        zone = self.zone_for(beacon.latitude, beacon.longitude)
                        sound, until = self.overrides.get(zone, ("ambient", 0))
                        if until and until < datetime.now(timezone.utc).timestamp():
                            self.overrides.pop(zone, None)
                            sound = "ambient"
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

                        event = self.pipeline.process(db, beacon, data, filename, "audio/wav", classification_hint=None if sound == "ambient" else sound)
                        self.last_event_at = event.timestamp
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
                    except Exception as exc:
                        self.last_error = f"{beacon.beacon_id}: {exc}"
                        logger.exception("Simulation processing failed for %s", beacon.beacon_id)
                        db.rollback()
                        continue
                self.last_cycle_at = datetime.now(timezone.utc)
            except Exception as exc:
                self.last_error = f"simulation cycle: {exc}"
                logger.exception("Simulation cycle failed")
                db.rollback()
            finally:
                db.close()
            await asyncio.sleep(10)




