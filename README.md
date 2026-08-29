# Foresight

Foresight is a forest acoustic surveillance demonstrator. The backend accepts
audio and heartbeat traffic from both the ESP32 beacon and the simulator,
classifies audio with YAMNet when installed, calculates an Acoustic Complexity
Index (ACI), scores threat likelihood, correlates nearby beacon events, and
pushes updates to the dashboard over WebSockets.

## Local quick start

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
uvicorn app.main:app --app-dir backend --reload
```

The API is available at `http://localhost:8000`, with interactive docs at
`/docs`. Run tests with `pytest` from the repository root.

The default database is SQLite (`foresight.db`). Set `DATABASE_URL` to a
PostgreSQL URL for hosted use. Supabase Storage is enabled by setting
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_BUCKET`; without
those settings, saved audio is served from the local uploads directory.

The map coordinates are representative coordinates in Tapajós National Forest;
the physical prototype is not represented as a live Amazon deployment.

## API highlights

- `POST /api/ingest/audio` — multipart `beacon_id` + `audio`
- `POST /api/ingest/heartbeat` — beacon heartbeat and battery percentage
- `GET /api/beacons`, `/api/events`, `/api/status`, `/api/aci`
- `POST /api/simulation/start`, `/stop`, `/trigger`
- `WS /ws` — typed live updates

Set `ENABLE_SIMULATION=true` (the default) to use simulator controls.
