from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class HeartbeatIn(BaseModel):
    beacon_id: str = Field(min_length=1, max_length=64)
    timestamp: datetime | None = None
    battery_percentage: float | None = Field(default=100.0, ge=0, le=100)


class BeaconOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    beacon_id: str
    latitude: float
    longitude: float
    is_real_hardware: bool


class StatusOut(BaseModel):
    beacon_id: str
    last_seen: datetime
    battery_percentage: float
    active: bool


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    beacon_id: str
    timestamp: datetime
    sound_class: str
    confidence: float
    threat_score: float
    aci_value: float
    final_score: float
    signal_strength: float
    audio_file_url: str | None
    is_confirmed: bool


class CorrelationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    event_ids: list[int]
    estimated_proximity_beacon_id: str
    timestamp: datetime


class SimulationTrigger(BaseModel):
    zone: str = Field(pattern=r"^zone_[0-3]_[0-3]$")
    sound: str = Field(min_length=1, max_length=64)
    duration_seconds: float = Field(default=10, ge=0.1, le=300)


class QueryResult(BaseModel):
    data: list[dict[str, Any]]
