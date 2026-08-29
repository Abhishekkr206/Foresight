# Foresight

Foresight is a forest acoustic surveillance demonstrator. The backend accepts
audio and heartbeat traffic from both the ESP32 beacon and the simulator,
classifies audio with YAMNet, calculates an Acoustic Complexity Index (ACI),
scores threat likelihood, correlates nearby beacon events, and pushes updates
to the dashboard over WebSockets.

## Local quick start

The verified local setup uses Python 3.11 because TensorFlow/YAMNet is not
supported by the project's Python 3.14 installation. The environment is kept
inside `backend\.venv-yamnet` and is ignored by Git.

### First-time backend setup

```powershell
cd D:\projects\Foresight
py -3.11 -m venv backend\.venv-yamnet
backend\.venv-yamnet\Scripts\python.exe -m pip install -r backend\requirements.txt
backend\.venv-yamnet\Scripts\python.exe -m pip install tensorflow tensorflow-hub librosa
```

Download and cache YAMNet once:

```powershell
cd D:\projects\Foresight\backend
.\.venv-yamnet\Scripts\Activate.ps1
python -c "import tensorflow_hub as hub; hub.load('https://tfhub.dev/google/yamnet/1'); print('YAMNET_READY')"
```

### Run the backend

In one terminal:

```powershell
cd D:\projects\Foresight\backend
.\.venv-yamnet\Scripts\Activate.ps1
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The API is available at `http://localhost:8000`; interactive docs are at
`http://localhost:8000/docs`.

### Run the frontend

In a second terminal:

```powershell
cd D:\projects\Foresight\frontend
npm install
npm run dev
```

Open `http://localhost:5173` after both services are running.

Run tests with `pytest` from the repository root.

## Configuration

The default database is SQLite (`backend/foresight.db`). Set `DATABASE_URL` to
a PostgreSQL URL for hosted use. Supabase Storage is enabled by setting
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_BUCKET`; without
those settings, saved audio is served from the local uploads directory.

Set `ENABLE_SIMULATION=true` in `backend/.env` to keep the simulator enabled.
It is enabled by default. The simulator is intended for local development;
the physical ESP32 beacon is not required to run the dashboard.

The map coordinates are representative coordinates in Tapajós National Forest;
the physical prototype is not represented as a live Amazon deployment.

## Simulation testing

The simulator continuously processes the ambient zone audio. To trigger a
threat from PowerShell, keep the backend running and call:

```powershell
$body = '{"zone":"zone_0_0","sound":"chainsaw","duration_seconds":30}'
Invoke-RestMethod -Uri 'http://localhost:8000/api/simulation/trigger' -Method Post -ContentType 'application/json' -Body $body
```

Available threat sounds are `chainsaw`, `gunshot`, `vehicle`, `engine`, and
`chopping`. Test sounds include `birds`, `frogs`, `insects`, `rain`, `wind`,
and `monkey`. Check `GET /api/simulation/status` to confirm the worker is
healthy. `GET /api/debug/classifier` should report `yamnet` and `521` labels.

## API highlights

- `POST /api/ingest/audio` — multipart `beacon_id` + `audio`
- `POST /api/ingest/heartbeat` — beacon heartbeat and battery percentage
- `GET /api/beacons`, `/api/events`, `/api/status`, `/api/aci`
- `POST /api/simulation/start`, `/stop`, `/trigger`
- `WS /ws` — typed live updates

## Hardware status

The ESP32 hardware integration is not required for the simulation deployment
and is not currently connected. The backend still exposes the hardware
ingestion endpoints for later local-network testing. Coordinates are assigned
manually in `beacons_config.json`; they are representative Tapajós National
Forest coordinates, not a live Amazon deployment.