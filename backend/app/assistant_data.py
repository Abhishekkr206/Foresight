"""Fresh, read-only monitoring context shared by Gemini and local conversation handling."""
from datetime import timedelta, timezone
from sqlalchemy import select
from . import health
from .models import Beacon
from .query import get_beacon_status
from .scoring import BOUNDS, get_zone


def event_dict(event):
    return dict(id=event.id, beacon_id=event.beacon_id, timestamp=health.utc(event.timestamp).isoformat(),
                sound_class=event.sound_class, confidence=event.confidence, threat_score=event.threat_score,
                aci_value=event.aci_value, final_score=event.final_score, is_confirmed=event.is_confirmed)


def monitoring_snapshot(db, settings, selection=None):
    now = health.datetime.now(timezone.utc)
    summary = health.get_forest_summary(db, settings, now=now)
    readings = health.latest_readings(db, now=now)
    statuses = {s['beacon_id']: s for s in get_beacon_status(db, settings)}
    beacons, zones = [], {z['zone_id']: {**z, 'beacon_ids': [], 'threats': []} for z in summary['zones']}
    for beacon in db.scalars(select(Beacon)).all():
        zone = get_zone(beacon.latitude, beacon.longitude, BOUNDS, settings.grid_size)
        state = statuses.get(beacon.beacon_id)
        beacons.append(dict(beacon_id=beacon.beacon_id, zone_id=zone,
            active=state['active'] if state else False,
            battery_percentage=state['battery_percentage'] if state else None,
            last_seen=health.utc(state['last_seen']).isoformat() if state else None))
        zones[zone]['beacon_ids'].append(beacon.beacon_id)
        event = readings.get(beacon.beacon_id)
        if event and event.final_score >= settings.event_threshold and health.utc(event.timestamp) >= now - timedelta(seconds=settings.heartbeat_timeout_seconds):
            zones[zone]['threats'].append(event_dict(event))
    selection = dict(selection or {})
    if selection.get('beacon_id') not in {b['beacon_id'] for b in beacons}:
        selection.pop('beacon_id', None)
    if selection.get('zone_id') not in zones:
        selection.pop('zone_id', None)
    return dict(observed_at=now.isoformat(), summary=summary, zones=list(zones.values()),
                beacons=beacons, selection=selection,
                latest_events=[event_dict(e) for name, e in readings.items() if name in {b['beacon_id'] for b in beacons}])
