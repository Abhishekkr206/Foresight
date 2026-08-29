from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings
from .models import Beacon, BeaconStatus, Event


def query_events(
    db: Session,
    *,
    threat_score_min: float | None = None,
    threat_score_max: float | None = None,
    beacon_id: str | None = None,
    confirmed: bool | None = None,
    start_time: datetime | None = None,
    end_time: datetime | None = None,
    limit: int = 100,
) -> list[Event]:
    query = select(Event).order_by(Event.timestamp.desc()).limit(max(1, min(limit, 500)))
    if threat_score_min is not None:
        query = query.where(Event.threat_score >= max(0.0, min(1.0, threat_score_min)))
    if threat_score_max is not None:
        query = query.where(Event.threat_score <= max(0.0, min(1.0, threat_score_max)))
    if beacon_id:
        query = query.where(Event.beacon_id == beacon_id)
    if confirmed is not None:
        query = query.where(Event.is_confirmed == confirmed)
    if start_time:
        query = query.where(Event.timestamp >= start_time)
    if end_time:
        query = query.where(Event.timestamp <= end_time)
    return list(db.scalars(query).all())


def get_beacon_status(db: Session, settings: Settings, beacon_id: str | None = None) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    query = select(BeaconStatus)
    if beacon_id:
        query = query.where(BeaconStatus.beacon_id == beacon_id)
    return [
        {
            "beacon_id": status.beacon_id,
            "last_seen": status.last_seen,
            "battery_percentage": status.battery_percentage,
            "active": now - status.last_seen <= timedelta(seconds=settings.heartbeat_timeout_seconds),
        }
        for status in db.scalars(query).all()
    ]


def get_aci_trend(db: Session, beacon_id: str, time_range: str = "24h") -> list[dict[str, Any]]:
    hours = int(time_range[:-1]) if time_range.endswith("h") and time_range[:-1].isdigit() else 24
    since = datetime.now(timezone.utc) - timedelta(hours=max(1, min(hours, 24 * 30)))
    query = select(Event).where(Event.beacon_id == beacon_id, Event.timestamp >= since).order_by(Event.timestamp.asc())
    return [{"timestamp": event.timestamp, "aci_value": event.aci_value, "event_id": event.id} for event in db.scalars(query).all()]


def answer_local_query(text: str, db: Session, settings: Settings) -> dict[str, Any]:
    """Small deterministic fallback; an LLM adapter can call the same safe functions later."""
    normalized = text.lower()
    filters: dict[str, Any] = {}
    if "below" in normalized or "under" in normalized:
        import re
        match = re.search(r"(?:below|under)\s+(\d+(?:\.\d+)?)\s*%?", normalized)
        if match:
            filters["threat_score_max"] = float(match.group(1)) / 100
    if "above" in normalized or "over" in normalized:
        import re
        match = re.search(r"(?:above|over)\s+(\d+(?:\.\d+)?)\s*%?", normalized)
        if match:
            filters["threat_score_min"] = float(match.group(1)) / 100
    if "confirmed" in normalized:
        filters["confirmed"] = True
    for candidate in ("BEACON_01", "BEACON_02", "BEACON_03"):
        if candidate.lower() in normalized or candidate.replace("_", " ").lower() in normalized:
            filters["beacon_id"] = candidate
    records = query_events(db, **filters)
    return {
        "answer": f"Found {len(records)} matching event{'s' if len(records) != 1 else ''}.",
        "filters": filters,
        "events": records,
    }

def _utc(value: datetime | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def get_forest_summary(db: Session, settings: Any) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    beacons = db.scalars(select(Beacon)).all()
    statuses = db.scalars(select(BeaconStatus)).all()
    event_list = db.scalars(select(Event)).all()
    active_threats = [event for event in event_list if event.final_score >= settings.event_threshold and _utc(event.timestamp) >= now - timedelta(seconds=settings.heartbeat_timeout_seconds)]
    active_count = sum(now - _utc(status.last_seen) <= timedelta(seconds=settings.heartbeat_timeout_seconds) for status in statuses)
    today_confirmed = [event for event in event_list if event.is_confirmed and _utc(event.timestamp) >= today]
    recent_events = [event for event in event_list if _utc(event.timestamp) >= now - timedelta(minutes=5)]
    latest_by_beacon: dict[str, Event] = {}
    for event in recent_events:
        current = latest_by_beacon.get(event.beacon_id)
        if current is None or _utc(event.timestamp) > _utc(current.timestamp):
            latest_by_beacon[event.beacon_id] = event
    live_average_aci = sum(event.aci_value for event in latest_by_beacon.values()) / len(latest_by_beacon) if latest_by_beacon else settings.aci_baseline
    aci_health = max(0.0, min(1.0, live_average_aci / settings.aci_baseline))
    active_threat_score = max((event.final_score for event in active_threats), default=0.0)
    threat_penalty = min(0.35, 0.35 * active_threat_score)
    health = max(0.0, min(1.0, aci_health - threat_penalty))
    return {
        'beacon_count': len(beacons),
        'active_beacon_count': active_count,
        'confirmed_events_today': len(today_confirmed),
        'live_average_aci': live_average_aci,
        'aci_health_score': round(aci_health * 100, 1),
        'active_threat_penalty': round(threat_penalty * 100, 1),
        'health_window_minutes': 5,
        'forest_health_score': round(health * 100, 1),
        'active_threat_count': len(active_threats),
    }
