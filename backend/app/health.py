"""Shared acoustic-health summary, with equal weighting for observed map zones."""
from datetime import datetime, timedelta, timezone
from statistics import fmean

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import Settings
from .models import Beacon, BeaconStatus, Event
from .scoring import BOUNDS, get_zone


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def clamp(value: float) -> float:
    return max(0.0, min(1.0, value))


def latest_readings(db: Session, *, now: datetime | None = None) -> dict[str, Event]:
    now = utc(now or datetime.now(timezone.utc))
    ranked = select(Event.id, func.row_number().over(
        partition_by=Event.beacon_id, order_by=(Event.timestamp.desc(), Event.id.desc())
    ).label('position')).where(Event.timestamp >= now - timedelta(minutes=5), Event.timestamp <= now).subquery()
    return {event.beacon_id: event for event in db.scalars(
        select(Event).join(ranked, Event.id == ranked.c.id).where(ranked.c.position == 1)).all()}


def get_forest_summary(db: Session, settings: Settings, *, now: datetime | None = None) -> dict:
    now = utc(now or datetime.now(timezone.utc))
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    beacons = list(db.scalars(select(Beacon)).all())
    active_count = db.scalar(select(func.count()).select_from(BeaconStatus).join(
        Beacon, Beacon.beacon_id == BeaconStatus.beacon_id).where(
        BeaconStatus.last_seen >= now - timedelta(seconds=settings.heartbeat_timeout_seconds),
        BeaconStatus.last_seen <= now)) or 0
    confirmed_count = db.scalar(select(func.count()).select_from(Event).where(
        Event.is_confirmed.is_(True), Event.timestamp >= today, Event.timestamp <= now)) or 0
    latest = latest_readings(db, now=now)
    grouped = {}
    for beacon in beacons:
        zone = get_zone(beacon.latitude, beacon.longitude, BOUNDS, settings.grid_size)
        grouped.setdefault(zone, []).append(beacon.beacon_id)
    zones, health_values, acoustic_values, aci_values, penalties = [], [], [], [], []
    active_threat_count = affected_count = 0
    for row in range(settings.grid_size):
        for col in range(settings.grid_size):
            zone = f'zone_{row}_{col}'
            ids = grouped.get(zone, [])
            readings = [latest[beacon_id] for beacon_id in ids if beacon_id in latest]
            threats = [event for event in readings if event.final_score >= settings.event_threshold
                       and utc(event.timestamp) >= now - timedelta(seconds=settings.heartbeat_timeout_seconds)]
            severity = max((clamp(event.final_score) for event in threats), default=0.0)
            acoustic = fmean(clamp(event.aci_value / settings.aci_baseline) for event in readings) if readings else None
            aci = fmean(event.aci_value for event in readings) if readings else None
            health = clamp(acoustic - 0.35 * severity) if acoustic is not None else None
            deduction = acoustic - health if health is not None else 0.0
            if health is not None:
                health_values.append(health)
                acoustic_values.append(acoustic)
                aci_values.append(aci)
                penalties.append(deduction)
            active_threat_count += len(threats)
            affected_count += bool(threats)
            zones.append(dict(zone_id=zone, configured_beacon_count=len(ids), reporting_beacon_count=len(readings),
                average_aci=aci, aci_health_score=round(acoustic * 100, 1) if acoustic is not None else None,
                threat_severity=severity, active_threat_count=len(threats),
                active_threat_penalty=round(deduction * 100, 1),
                health_score=round(health * 100, 1) if health is not None else None,
                latest_reading_at=max((utc(event.timestamp) for event in readings), default=None).isoformat() if readings else None))
    historical = db.scalar(select(func.avg(Event.aci_value)))
    current_aci = fmean(aci_values) if aci_values else None
    return dict(beacon_count=len(beacons), active_beacon_count=active_count,
        confirmed_events_today=confirmed_count, average_aci=current_aci, live_average_aci=current_aci,
        historical_average_aci=historical if historical is not None else settings.aci_baseline,
        forest_health_score=round(fmean(health_values) * 100, 1) if health_values else None,
        aci_health_score=round(fmean(acoustic_values) * 100, 1) if acoustic_values else None,
        active_threat_penalty=round(fmean(penalties) * 100, 1) if penalties else 0.0,
        active_threat_count=active_threat_count, health_window_minutes=5,
        observed_zone_count=len(health_values), populated_zone_count=len(grouped),
        affected_zone_count=affected_count, total_zone_count=settings.grid_size ** 2, zones=zones)
