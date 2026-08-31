from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    database_url: str = "sqlite:///./foresight.db"
    beacon_config_path: Path = ROOT / "beacons_config.json"
    uploads_dir: Path = ROOT / "uploads"
    simulation_audio_dir: Path = ROOT / "backend" / "audio" / "zones"
    simulation_threat_audio_dir: Path = ROOT / "backend" / "audio" / "threats"
    simulation_test_audio_dir: Path = ROOT / "backend" / "audio" / "test"
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    heartbeat_timeout_seconds: int = Field(default=45, ge=5)
    correlation_window_seconds: int = Field(default=20, ge=1)
    event_threshold: float = Field(default=0.45, ge=0, le=1)
    threat_confidence_threshold: float = Field(default=0.70, ge=0, le=1)
    save_threshold: float = Field(default=0.60, ge=0, le=1)
    aci_baseline: float = Field(default=1.0, gt=0)
    grid_size: int = Field(default=4, ge=1, le=20)
    max_audio_bytes: int = Field(default=10_000_000, ge=1_000)
    enable_simulation: bool = True
    supabase_url: str | None = None
    supabase_service_role_key: str | None = None
    supabase_bucket: str = "foresight-audio"
    assistant_enabled: bool = False
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.1-flash-lite"
    gemini_timeout_seconds: int = Field(default=20, ge=5, le=120)

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


