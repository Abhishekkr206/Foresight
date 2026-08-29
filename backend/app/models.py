from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Beacon(Base):
    __tablename__ = "beacons"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    beacon_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    is_real_hardware: Mapped[bool] = mapped_column(Boolean, default=False)
    events: Mapped[list["Event"]] = relationship(back_populates="beacon")


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    beacon_id: Mapped[str] = mapped_column(ForeignKey("beacons.beacon_id"), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    sound_class: Mapped[str] = mapped_column(String(160))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    threat_score: Mapped[float] = mapped_column(Float)
    aci_value: Mapped[float] = mapped_column(Float)
    final_score: Mapped[float] = mapped_column(Float, index=True)
    signal_strength: Mapped[float] = mapped_column(Float, default=0.0)
    audio_file_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    beacon: Mapped[Beacon] = relationship(back_populates="events")


class Correlation(Base):
    __tablename__ = "correlations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    event_ids: Mapped[list[int]] = mapped_column(JSON)
    estimated_proximity_beacon_id: Mapped[str] = mapped_column(String(64))
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BeaconStatus(Base):
    __tablename__ = "beacon_status"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    beacon_id: Mapped[str] = mapped_column(ForeignKey("beacons.beacon_id"), unique=True, index=True)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    battery_percentage: Mapped[float] = mapped_column(Float)
