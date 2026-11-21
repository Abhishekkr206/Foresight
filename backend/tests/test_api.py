import os
import pytest
import tempfile
import json
from pathlib import Path

_test_directory = tempfile.TemporaryDirectory(prefix="foresight-tests-")
os.environ["DATABASE_URL"] = "sqlite:///" + (Path(_test_directory.name) / "test.db").as_posix()
os.environ["ENABLE_SIMULATION"] = "false"

from fastapi.testclient import TestClient

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


def test_health_and_seeded_beacons():
    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
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
def test_summary_and_event_detail_endpoints():
    with TestClient(app) as client:
        audio_response = client.post(
            "/api/ingest/audio?beacon_id=BEACON_02",
            files={"audio": ("capture.wav", make_demo_wav("gunshot"), "audio/wav")},
        )
        assert audio_response.status_code == 201
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
