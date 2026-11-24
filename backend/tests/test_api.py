import os
import pytest
import tempfile
import json
from time import time
from pathlib import Path

_test_directory = tempfile.TemporaryDirectory(prefix="foresight-tests-")
os.environ["DATABASE_URL"] = "sqlite:///" + (Path(_test_directory.name) / "test.db").as_posix()
os.environ["ENABLE_SIMULATION"] = "false"

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
import jwt
from pydantic import SecretStr

from app.audio import make_demo_wav
from app import audio
from app.main import app
from app import main


@pytest.fixture(scope='session', autouse=True)
def close_test_database():
    yield
    main.engine.dispose()
    _test_directory.cleanup()


@pytest.fixture(autouse=True)
def offline_classifier(monkeypatch, tmp_path):
    monkeypatch.setattr(audio, '_yamnet', lambda: None)
    monkeypatch.setattr(main.storage, 'supabase', None)
    monkeypatch.setattr(main.storage.settings, 'uploads_dir', tmp_path)


EXPECTED_BEACON_COUNT = len(json.loads((Path(__file__).parents[2] / "beacons_config.json").read_text(encoding="utf-8")))


def test_health_and_seeded_beacons(sign_in):
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
        assert client.get("/api/beacons").status_code == 401
        sign_in(client)
        assert len(client.get("/api/beacons").json()) == EXPECTED_BEACON_COUNT


def test_heartbeat_derives_active_state():
    with TestClient(app) as client:
        response = client.post("/api/ingest/heartbeat", json={"beacon_id": "BEACON_01", "battery_percentage": 87.5})
        assert response.status_code == 200
        assert response.json()["active"] is True
        assert response.json()["battery_percentage"] == 87.5


def test_audio_ingestion_creates_event(monkeypatch):
    monkeypatch.setattr(audio, '_yamnet', lambda: None)
    with TestClient(app) as client:
        response = client.post(
            "/api/ingest/audio?beacon_id=BEACON_02",
            files={"audio": ("capture.wav", make_demo_wav("gunshot"), "audio/wav")},
        )
        assert response.status_code == 201
        body = response.json()
        assert body["beacon_id"] == "BEACON_02"
        assert body["sound_class"] in {"Gunshot", "Explosion"}
        assert 0 <= body["final_score"] <= 1
def test_summary_and_event_detail_endpoints(sign_in):
    with TestClient(app) as client:
        audio_response = client.post(
            "/api/ingest/audio?beacon_id=BEACON_02",
            files={"audio": ("capture.wav", make_demo_wav("gunshot"), "audio/wav")},
        )
        assert audio_response.status_code == 201
        sign_in(client)
        event = audio_response.json()
        detail = client.get(f"/api/events/{event['id']}")
        assert detail.status_code == 200
        assert detail.json()["event"]["id"] == event["id"]
        summary = client.get("/api/summary")
        assert summary.status_code == 200
        assert summary.json()["beacon_count"] == EXPECTED_BEACON_COUNT
        filtered = client.get("/api/events?min_final_score=0.9")
        assert filtered.status_code == 200
        assert all(item["final_score"] >= 0.9 for item in filtered.json())


def test_login_fails_closed_when_unconfigured(monkeypatch):
    monkeypatch.setattr(main.settings, 'foresight_jwt_secret', SecretStr(''))
    with TestClient(app) as client:
        assert client.post('/api/auth/login', json={'login_id': 'test', 'password': 'test'}).status_code == 503
        assert client.get('/api/events').status_code == 401


def test_session_and_recording_require_a_valid_token(sign_in, login_credentials, tmp_path):
    (tmp_path / 'capture.wav').write_bytes(b'audio')
    with TestClient(app) as client:
        for field in login_credentials:
            rejected = client.post('/api/auth/login', json={**login_credentials, field: 'wrong'})
            assert rejected.status_code == 401
            assert rejected.json()['detail'] == 'Invalid login ID or password'
        assert client.get('/uploads/capture.wav').status_code == 401
        token = sign_in(client)
        assert client.get('/api/auth/session').json()['expires_at'] > time()
        assert client.get('/uploads/capture.wav').content == b'audio'
        header, payload, signature = token.split('.')
        altered_signature = ('A' if signature[0] != 'A' else 'B') + signature[1:]
        assert client.get('/api/events', headers={'Authorization': f'Bearer {header}.{payload}.{altered_signature}'}).status_code == 401


def test_websocket_requires_a_token_and_disconnects_on_expiry(sign_in):
    with TestClient(app) as client:
        with client.websocket_connect('/ws') as socket:
            socket.send_text('invalid')
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_json()
            assert closed.value.code == 4401

        sign_in(client)
        now = int(time())
        short_token = jwt.encode(
            {'iss': 'foresight', 'sub': 'test-operator', 'iat': now, 'exp': now + 2},
            main.settings.foresight_jwt_secret.get_secret_value(),
            algorithm='HS256',
        )
        with client.websocket_connect('/ws') as socket:
            socket.send_text(short_token)
            assert socket.receive_json()['type'] == 'auth.ready'
            response = client.post('/api/ingest/heartbeat', json={'beacon_id': 'BEACON_01', 'battery_percentage': 90})
            assert response.status_code == 200
            assert socket.receive_json()['type'] == 'beacon.status'
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_json()
            assert closed.value.code == 4401
        assert client.get('/api/events', headers={'Authorization': f'Bearer {short_token}'}).status_code == 401
