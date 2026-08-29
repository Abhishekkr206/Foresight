from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import asyncio
import json

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .assistant import AssistantRequest, AssistantResponse, answer_query
from .config import get_settings
from .db import Base, SessionLocal, engine, get_db
from .models import Beacon, BeaconStatus, Correlation, Event
from .pipeline import Pipeline
from .query import get_aci_trend as safe_get_aci_trend, get_beacon_status as safe_get_beacon_status, query_events as safe_query_events
from .schemas import BeaconOut, CorrelationOut, EventOut, HeartbeatIn, SimulationTrigger, StatusOut
from .simulation import BOUNDS, Simulator
from .storage import AudioStorage

settings = get_settings()
clients: set[WebSocket] = set()
main_loop: asyncio.AbstractEventLoop | None = None


def json_default(value):
    if hasattr(value, 'isoformat'):
        return value.isoformat()
    if hasattr(value, '__table__'):
        return {column.name: getattr(value, column.name) for column in value.__table__.columns}
    return value


def _broadcast_encoded(encoded: dict):
    for client in list(clients):
        try:
            asyncio.create_task(client.send_json(encoded))
        except Exception:
            clients.discard(client)


def broadcast(message: dict):
    encoded = json.loads(json.dumps(message, default=json_default))
    try:
        current_loop = asyncio.get_running_loop()
    except RuntimeError:
        current_loop = None
    if main_loop and main_loop.is_running() and current_loop is not main_loop:
        main_loop.call_soon_threadsafe(_broadcast_encoded, encoded)
    else:
        _broadcast_encoded(encoded)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def seed_beacons(db: Session):
    config = json.loads(settings.beacon_config_path.read_text(encoding='utf-8'))
    for beacon_id, item in config.items():
        beacon = db.scalar(select(Beacon).where(Beacon.beacon_id == beacon_id))
        if beacon is None:
            db.add(Beacon(beacon_id=beacon_id, latitude=item['lat'], longitude=item['lon'], is_real_hardware=item['is_real_hardware']))
        else:
            beacon.latitude = item['lat']
            beacon.longitude = item['lon']
            beacon.is_real_hardware = item['is_real_hardware']
    db.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global main_loop
    main_loop = asyncio.get_running_loop()
    Base.metadata.create_all(engine)
    db = SessionLocal()
    try:
        seed_beacons(db)
    finally:
        db.close()
    if settings.enable_simulation:
        app.state.simulator.start()
    yield
    await app.state.simulator.stop()


app = FastAPI(title='Foresight Forest Acoustic Surveillance API', version='1.0.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=True, allow_methods=['*'], allow_headers=['*'])
storage = AudioStorage(settings)
pipeline = Pipeline(settings, storage, broadcast)
app.state.simulator = Simulator(settings, SessionLocal, pipeline)


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'foresight-api'}


@app.get('/api/beacons', response_model=list[BeaconOut])
def beacons(db: Session = Depends(get_db)):
    return db.scalars(select(Beacon).order_by(Beacon.beacon_id)).all()


@app.post('/api/ingest/heartbeat', response_model=StatusOut)
def heartbeat(payload: HeartbeatIn, db: Session = Depends(get_db)):
    beacon = db.scalar(select(Beacon).where(Beacon.beacon_id == payload.beacon_id))
    if beacon is None:
        raise HTTPException(404, 'unknown beacon_id')
    status = db.scalar(select(BeaconStatus).where(BeaconStatus.beacon_id == payload.beacon_id))
    if status is None:
        status = BeaconStatus(beacon_id=payload.beacon_id, last_seen=datetime.now(timezone.utc), battery_percentage=payload.battery_percentage)
        db.add(status)
    else:
        status.last_seen = datetime.now(timezone.utc)
        status.battery_percentage = payload.battery_percentage
    db.commit()
    db.refresh(status)
    result = StatusOut(beacon_id=status.beacon_id, last_seen=status.last_seen, battery_percentage=status.battery_percentage, active=True)
    broadcast({'type': 'beacon.status', 'data': result.model_dump()})
    return result


def _process_uploaded_audio(beacon_id: str, data: bytes, filename: str, content_type: str):
    db = SessionLocal()
    try:
        beacon = db.scalar(select(Beacon).where(Beacon.beacon_id == beacon_id))
        if beacon is None:
            raise HTTPException(404, 'unknown beacon_id')
        return pipeline.process(db, beacon, data, filename, content_type)
    finally:
        db.close()


@app.post('/api/ingest/audio', response_model=EventOut, status_code=201)
async def ingest_audio(beacon_id: str, audio: UploadFile = File(...)):
    data = await audio.read(settings.max_audio_bytes + 1)
    if len(data) > settings.max_audio_bytes:
        raise HTTPException(413, 'audio file too large')
    return await asyncio.to_thread(_process_uploaded_audio, beacon_id, data, audio.filename or 'capture.wav', audio.content_type or 'audio/wav')


@app.get('/api/events', response_model=list[EventOut])
def events(limit: int = Query(100, ge=1, le=500), beacon_id: str | None = None, confirmed: bool | None = None, min_final_score: float | None = Query(None, ge=0, le=1), max_final_score: float | None = Query(None, ge=0, le=1), sound_class: str | None = None, start_time: datetime | None = None, end_time: datetime | None = None, db: Session = Depends(get_db)):
    query = select(Event).order_by(desc(Event.timestamp)).limit(limit)
    if beacon_id: query = query.where(Event.beacon_id == beacon_id)
    if confirmed is not None: query = query.where(Event.is_confirmed == confirmed)
    if min_final_score is not None: query = query.where(Event.final_score >= min_final_score)
    if max_final_score is not None: query = query.where(Event.final_score <= max_final_score)
    if sound_class: query = query.where(Event.sound_class == sound_class)
    if start_time: query = query.where(Event.timestamp >= start_time)
    if end_time: query = query.where(Event.timestamp <= end_time)
    return db.scalars(query).all()


@app.get('/api/events/{event_id}')
def event_detail(event_id: int, db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    if event is None: raise HTTPException(404, 'event not found')
    beacon = db.scalar(select(Beacon).where(Beacon.beacon_id == event.beacon_id))
    return {'event': EventOut.model_validate(event).model_dump(mode='json'), 'beacon': BeaconOut.model_validate(beacon).model_dump(mode='json') if beacon else None}


@app.get('/api/events/{event_id}/correlation')
def event_correlation(event_id: int, db: Session = Depends(get_db)):
    correlations = db.scalars(select(Correlation).order_by(desc(Correlation.timestamp))).all()
    correlation = next((item for item in correlations if event_id in (item.event_ids or [])), None)
    if correlation is None: return {'correlation': None, 'events': [], 'beacons': []}
    related = db.scalars(select(Event).where(Event.id.in_(correlation.event_ids))).all()
    beacon_ids = {item.beacon_id for item in related}
    related_beacons = db.scalars(select(Beacon).where(Beacon.beacon_id.in_(beacon_ids))).all()
    return {'correlation': CorrelationOut.model_validate(correlation).model_dump(mode='json'), 'events': [EventOut.model_validate(item).model_dump(mode='json') for item in related], 'beacons': [BeaconOut.model_validate(item).model_dump(mode='json') for item in related_beacons]}


@app.get('/api/summary')
def summary(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    beacon_list = db.scalars(select(Beacon)).all()
    statuses = db.scalars(select(BeaconStatus)).all()
    event_list = db.scalars(select(Event)).all()
    today_confirmed = [event for event in event_list if event.is_confirmed and as_utc(event.timestamp) >= today]
    active_threats = [event for event in event_list if event.final_score >= settings.event_threshold and as_utc(event.timestamp) >= now - timedelta(seconds=settings.heartbeat_timeout_seconds)]
    active_count = sum(now - as_utc(status.last_seen) <= timedelta(seconds=settings.heartbeat_timeout_seconds) for status in statuses)
    health_window_start = now - timedelta(minutes=5)
    recent_events = [event for event in event_list if as_utc(event.timestamp) >= health_window_start]
    latest_by_beacon = {}
    for event in recent_events:
        current = latest_by_beacon.get(event.beacon_id)
        if current is None or as_utc(event.timestamp) > as_utc(current.timestamp):
            latest_by_beacon[event.beacon_id] = event
    live_average_aci = sum(event.aci_value for event in latest_by_beacon.values()) / len(latest_by_beacon) if latest_by_beacon else settings.aci_baseline
    aci_health = max(0.0, min(1.0, live_average_aci / settings.aci_baseline))
    active_threat_score = max((event.final_score for event in active_threats), default=0.0)
    threat_penalty = min(0.35, 0.35 * active_threat_score)
    health = max(0.0, min(1.0, aci_health - threat_penalty))
    historical_average_aci = sum(event.aci_value for event in event_list) / len(event_list) if event_list else settings.aci_baseline
    return {'beacon_count': len(beacon_list), 'active_beacon_count': active_count, 'confirmed_events_today': len(today_confirmed), 'average_aci': live_average_aci, 'historical_average_aci': historical_average_aci, 'live_average_aci': live_average_aci, 'aci_health_score': round(aci_health * 100, 1), 'active_threat_penalty': round(threat_penalty * 100, 1), 'health_window_minutes': 5, 'forest_health_score': round(health * 100, 1), 'active_threat_count': len(active_threats)}


@app.get('/api/status', response_model=list[StatusOut])
def statuses(beacon_id: str | None = None, db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    query = select(BeaconStatus)
    if beacon_id: query = query.where(BeaconStatus.beacon_id == beacon_id)
    return [StatusOut(beacon_id=item.beacon_id, last_seen=item.last_seen, battery_percentage=item.battery_percentage, active=now - as_utc(item.last_seen) <= timedelta(seconds=settings.heartbeat_timeout_seconds)) for item in db.scalars(query).all()]


@app.get('/api/aci')
def aci(beacon_id: str | None = None, limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)):
    query = select(Event).order_by(desc(Event.timestamp)).limit(limit)
    if beacon_id: query = query.where(Event.beacon_id == beacon_id)
    return [{'beacon_id': event.beacon_id, 'timestamp': event.timestamp, 'aci_value': event.aci_value} for event in db.scalars(query).all()]


@app.get('/uploads/{filename}')
def uploaded_file(filename: str):
    path = settings.uploads_dir / filename
    if not path.is_file() or path.parent != settings.uploads_dir: raise HTTPException(404, 'audio not found')
    return FileResponse(path)


@app.post('/api/simulation/start')
def start_simulation():
    if not settings.enable_simulation: raise HTTPException(404, 'simulation disabled')
    app.state.simulator.start(); result = app.state.simulator.status(); broadcast({'type': 'simulation.status', 'data': result}); return result


@app.get('/api/simulation/status')
def simulation_status():
    if not settings.enable_simulation: return {'running': False, 'zones': {}}
    return app.state.simulator.status()


@app.post('/api/simulation/stop')
async def stop_simulation():
    await app.state.simulator.stop(); result = app.state.simulator.status(); broadcast({'type': 'simulation.status', 'data': result}); return result


@app.post('/api/simulation/trigger')
def trigger_simulation(payload: SimulationTrigger):
    if not settings.enable_simulation: raise HTTPException(404, 'simulation disabled')
    try: app.state.simulator.trigger(payload.zone, payload.sound, payload.duration_seconds)
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc
    result = app.state.simulator.status(); broadcast({'type': 'simulation.status', 'data': result}); return result


@app.get('/api/query/events', response_model=list[EventOut])
def safe_events(threat_score_min: float | None = Query(None, ge=0, le=1), threat_score_max: float | None = Query(None, ge=0, le=1), beacon_id: str | None = None, confirmed: bool | None = None, start_time: datetime | None = None, end_time: datetime | None = None, limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)):
    return safe_query_events(db, threat_score_min=threat_score_min, threat_score_max=threat_score_max, beacon_id=beacon_id, confirmed=confirmed, start_time=start_time, end_time=end_time, limit=limit)


@app.get('/api/query/status')
def safe_status(beacon_id: str | None = None, db: Session = Depends(get_db)):
    return safe_get_beacon_status(db, settings, beacon_id)


@app.get('/api/query/aci')
def safe_aci(beacon_id: str, time_range: str = '24h', db: Session = Depends(get_db)):
    return safe_get_aci_trend(db, beacon_id, time_range)


@app.post('/api/assistant/query', response_model=AssistantResponse)
def assistant_query(payload: AssistantRequest, db: Session = Depends(get_db)):
    return answer_query(payload.prompt, db, settings)


@app.websocket('/ws')
async def websocket(websocket: WebSocket):
    await websocket.accept(); clients.add(websocket)
    try:
        while True: await websocket.receive_text()
    except WebSocketDisconnect: clients.discard(websocket)
