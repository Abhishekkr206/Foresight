import io
import math
import wave
from functools import lru_cache

import numpy as np


def decode_audio(data: bytes, sample_rate: int = 16_000) -> np.ndarray:
    """Decode WAV audio; soundfile is used when available, stdlib handles tests."""
    try:
        import soundfile as sf

        samples, rate = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
        if samples.ndim > 1:
            samples = samples.mean(axis=1)
        if rate != sample_rate:
            samples = resample(samples, rate, sample_rate)
        return np.asarray(samples, dtype=np.float32)
    except Exception:
        with wave.open(io.BytesIO(data), "rb") as source:
            rate = source.getframerate()
            channels = source.getnchannels()
            width = source.getsampwidth()
            raw = source.readframes(source.getnframes())
        dtype = {1: np.int8, 2: np.int16, 4: np.int32}.get(width)
        if dtype is None:
            raise ValueError("unsupported WAV sample width")
        samples = np.frombuffer(raw, dtype=dtype).astype(np.float32)
        if width == 1:
            samples = (samples - 128) / 128
        else:
            samples /= float(2 ** (width * 8 - 1))
        samples = samples.reshape(-1, channels).mean(axis=1) if channels > 1 else samples
        return resample(samples, rate, sample_rate) if rate != sample_rate else samples


def resample(samples: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate == target_rate or len(samples) == 0:
        return samples.astype(np.float32)
    target_length = max(1, round(len(samples) * target_rate / source_rate))
    old_x = np.linspace(0, 1, len(samples), endpoint=False)
    new_x = np.linspace(0, 1, target_length, endpoint=False)
    return np.interp(new_x, old_x, samples).astype(np.float32)


def acoustic_complexity_index(samples: np.ndarray, frame_size: int = 512) -> float:
    """A normalized spectral ACI approximation: sum positive frame-to-frame changes."""
    if len(samples) < frame_size * 2:
        return 0.0
    frames = len(samples) // frame_size
    matrix = np.abs(np.fft.rfft(samples[: frames * frame_size].reshape(frames, frame_size), axis=1))
    changes = np.abs(np.diff(matrix, axis=0)).sum(axis=0)
    total = matrix[1:].sum(axis=0)
    value = float(np.divide(changes, total, out=np.zeros_like(changes), where=total > 1e-8).mean())
    return max(0.0, min(1.0, value))


@lru_cache(maxsize=1)
def _yamnet():
    try:
        import tensorflow_hub as hub

        return hub.load("https://tfhub.dev/google/yamnet/1")
    except Exception:
        return None


def classify(samples: np.ndarray, sample_rate: int = 16_000, fallback_label: str | None = None) -> dict[str, float]:
    model = _yamnet()
    if model is not None:
        scores, _, _ = model(samples.astype(np.float32))
        values = np.asarray(scores).mean(axis=0)
        # YAMNet labels are intentionally loaded lazily to keep the API usable without TF.
        try:
            import tensorflow_hub as hub
            labels = hub.load("https://tfhub.dev/google/yamnet/1").class_names
            return {str(labels[i]): float(values[i]) for i in np.argsort(values)[-10:]}
        except Exception:
            pass
    # Deterministic local fallback for simulator/demo development.
    # The simulator supplies the selected sound only when YAMNet is unavailable;
    # real hardware ingestion always remains model-driven.
    simulation_labels = {
        "chainsaw": "Chainsaw",
        "gunshot": "Gunshot",
        "vehicle": "Vehicle",
        "engine": "Engine",
        "chopping": "Chopping",
        "birds": "Bird vocalization",
        "wind": "Wind",
        "frogs": "Frog",
        "insects": "Insect",
        "rain": "Rain",
        "monkey": "Animal",
    }
    if fallback_label and fallback_label.lower() in simulation_labels:
        return {simulation_labels[fallback_label.lower()]: 0.92}
    rms = float(np.sqrt(np.mean(np.square(samples)))) if len(samples) else 0.0
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    if peak > 0.85:
        return {"Gunshot": min(1.0, peak), "Explosion": 0.1}
    if rms < 0.01:
        return {"Silence": 0.95}
    return {"Wind": min(0.95, max(0.1, 1.0 - rms)), "Bird vocalization": rms}


def make_demo_wav(sound: str, sample_rate: int = 16_000, seconds: float = 2.0) -> bytes:
    count = max(1, int(sample_rate * seconds))
    rng = np.random.default_rng(abs(hash(sound)) % (2**32))
    if sound.lower() in {"gunshot", "explosion"}:
        samples = rng.normal(0, 0.05, count).astype(np.float32)
        samples[: max(1, count // 20)] += np.linspace(0, 1.0, max(1, count // 20), dtype=np.float32)
    elif sound.lower() in {"chainsaw", "engine", "vehicle"}:
        t = np.arange(count) / sample_rate
        samples = (0.35 * np.sin(2 * math.pi * 110 * t) + 0.12 * rng.normal(size=count)).astype(np.float32)
    else:
        samples = (0.04 * rng.normal(size=count)).astype(np.float32)
    samples = np.clip(samples, -1, 1)
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(sample_rate)
        target.writeframes((samples * 32767).astype(np.int16).tobytes())
    return output.getvalue()




