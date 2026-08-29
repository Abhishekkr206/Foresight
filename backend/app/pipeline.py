from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Lock

from sqlalchemy import select
from sqlalchemy.orm import Session

from .audio import acoustic_complexity_index, classify, decode_audio
from .config import Settings
from .models import Beacon, Correlation, Event
from .scoring import fuse, threat_score
from .storage import AudioStorage


class Pipeline:
    def __init__(self, settings: Settings, storage: AudioStorage, broadcaster):
        self.settings = settings
        self.storage = storage
        self.broadcaster = broadcaster
        self._latest_audio: dict[str, dict] = {}
        self._latest_audio_lock = Lock()

    def latest_audio(self, beacon_id: str) -> dict | None:
        """Return the most recent decoded capture for a beacon, if available."""
        with self._latest_audio_lock:
            capture = self._latest_audio.get(beacon_id)
            if capture is None:
                return None
            return {
                **capture,
                "data": bytes(capture["data"]),
                "samples": capture["samples"].copy(),
            }

    def process(self, db: Session, beacon: Beacon, data: bytes, filename: str, content_type: str, classification_hint: str | None = None) -> Event:
        samples = decode_audio(data)
        with self._latest_audio_lock:
            self._latest_audio[beacon.beacon_id] = {
                "data": bytes(data),
                "samples": samples.copy(),
                "filename": filename,
                "content_type": content_type,
                "received_at": datetime.now(timezone.utc),
            }
        classes = classify(samples, fallback_label=classification_hint)
        label, confidence, threat = threat_score(classes)
        aci = acoustic_complexity_index(samples)
        final, _ = fuse(threat, aci, self.settings.aci_baseline)
        event = Event(
            beacon_id=beacon.beacon_id,
            timestamp=datetime.now(timezone.utc),
            sound_class=label,
            confidence=confidence,
            threat_score=threat,
            aci_value=aci,
            final_score=final,
            signal_strength=confidence,
        )
        if final >= self.settings.save_threshold:
            event.audio_file_url = self.storage.save(data, f"{beacon.beacon_id}_{event.timestamp.timestamp():.0f}_{Path(filename).name}", content_type)
        db.add(event)
        db.commit()
        db.refresh(event)
        self._correlate(db, event)
        self.broadcaster({"type": "event.created", "data": event})
        return event

    def _correlate(self, db: Session, event: Event) -> None:
        if event.final_score < self.settings.event_threshold:
            return
        since = event.timestamp - timedelta(seconds=self.settings.correlation_window_seconds)
        related = db.scalars(
            select(Event).where(Event.timestamp >= since, Event.timestamp <= event.timestamp, Event.id != event.id, Event.beacon_id != event.beacon_id, Event.final_score >= self.settings.event_threshold)
        ).all()
        if not related:
            return
        events = [*related, event]
        for item in events:
            item.is_confirmed = True
        nearest = max(events, key=lambda item: item.signal_strength)
        correlation = Correlation(event_ids=[item.id for item in events], estimated_proximity_beacon_id=nearest.beacon_id)
        db.add(correlation)
        db.commit()
        db.refresh(correlation)
        self.broadcaster({"type": "event.confirmed", "data": correlation})

