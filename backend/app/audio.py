import csv
import io
import logging
import math
import wave
from functools import lru_cache
from pathlib import Path

import numpy as np


logger = logging.getLogger(__name__)


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
    except Exception as exc:
        logger.warning("YAMNet unavailable; using fallback classifier: %s", exc)
        return None


def _canonical_label(label: str) -> str:
    """Map common YAMNet labels to the labels used by the threat scorer."""
    normalized = label.lower().replace('_', ' ').replace('-', ' ')
    if 'gunshot' in normalized or 'gunfire' in normalized:
        return 'Gunshot'
    if 'chainsaw' in normalized or 'power saw' in normalized:
        return 'Chainsaw'
    if 'engine' in normalized or 'machine noise' in normalized:
        return 'Engine'
    if 'vehicle' in normalized or 'motor vehicle' in normalized:
        return 'Vehicle'
    if 'chop' in normalized:
        return 'Chopping'
    if 'silence' in normalized:
        return 'Silence'
    if 'wind' in normalized:
        return 'Wind'
    if 'bird' in normalized:
        return 'Bird vocalization'
    return label


def _label_text(value: object) -> str:
    """Convert TensorFlow string tensors/bytes into ordinary text."""
    if hasattr(value, 'numpy'):
        value = value.numpy()
    if isinstance(value, bytes):
        return value.decode('utf-8')
    return str(value)


def _yamnet_labels(model) -> list[str]:
    """Load labels from either older or newer YAMNet SavedModel exports."""
    class_names = getattr(model, 'class_names', None)
    if class_names is not None:
        return [_label_text(value) for value in class_names]

    class_map_path = getattr(model, 'class_map_path', None)
    if class_map_path is None:
        raise RuntimeError('YAMNet model has no class label map')
    path_value = class_map_path()
    path = Path(_label_text(path_value))
    with path.open(newline='', encoding='utf-8') as source:
        return [row['display_name'] for row in csv.DictReader(source)]


def classifier_status() -> dict[str, object]:
    """Return the active classifier without running audio inference."""
    model = _yamnet()
    if model is None:
        return {'classifier': 'fallback', 'yamnet_loaded': False}
    try:
        labels = _yamnet_labels(model)
        return {'classifier': 'yamnet', 'yamnet_loaded': True, 'label_count': len(labels)}
    except Exception as exc:
        logger.warning('YAMNet loaded but labels are unavailable: %s', exc)
        return {'classifier': 'fallback', 'yamnet_loaded': False, 'error': str(exc)}


def _fallback_features(samples: np.ndarray, sample_rate: int) -> dict[str, float]:
    """Calculate inexpensive temporal features for the offline classifier."""
    if len(samples) == 0:
        return {'rms': 0.0, 'peak': 0.0, 'crest_factor': 0.0, 'transient_ratio': 0.0, 'sustained_fraction': 0.0, 'spectral_centroid': 0.0}

    absolute = np.abs(samples)
    rms = float(np.sqrt(np.mean(np.square(samples))))
    peak = float(np.max(absolute))
    frame_size = max(1, int(sample_rate * 0.025))
    hop = max(1, frame_size // 2)
    frame_rms = []
    for start in range(0, max(1, len(samples) - frame_size + 1), hop):
        frame = samples[start:start + frame_size]
        if len(frame):
            frame_rms.append(float(np.sqrt(np.mean(np.square(frame)))))
    frame_values = np.asarray(frame_rms, dtype=np.float32)
    median_frame_rms = float(np.median(frame_values)) if len(frame_values) else 0.0
    max_frame_rms = float(np.max(frame_values)) if len(frame_values) else 0.0
    sustained_fraction = float(np.mean(frame_values >= max(0.02, max_frame_rms * 0.35))) if len(frame_values) else 0.0

    window = samples[:min(len(samples), sample_rate)]
    spectrum = np.abs(np.fft.rfft(window * np.hanning(len(window)))) if len(window) > 1 else np.asarray([0.0])
    frequencies = np.fft.rfftfreq(len(window), 1 / sample_rate) if len(window) > 1 else np.asarray([0.0])
    spectral_total = float(np.sum(spectrum))
    spectral_centroid = float(np.sum(frequencies * spectrum) / spectral_total) if spectral_total > 1e-8 else 0.0

    return {
        'rms': rms,
        'peak': peak,
        'crest_factor': peak / max(rms, 1e-6),
        'transient_ratio': max_frame_rms / max(median_frame_rms, 1e-6),
        'sustained_fraction': sustained_fraction,
        'spectral_centroid': spectral_centroid,
    }


def classify(samples: np.ndarray, sample_rate: int = 16_000, fallback_label: str | None = None) -> dict[str, float]:
    # Simulation threat triggers carry an explicit sound selection. Honour
    # that selection so generic YAMNet labels such as "Tools" do not make a
    # chainsaw or gunshot demo fall below the threat threshold. Hardware and
    # ambient captures still use YAMNet normally because they have no hint.
    simulation_threat_labels = {
        "chainsaw": "Chainsaw",
        "gunshot": "Gunshot",
        "vehicle": "Vehicle",
        "engine": "Engine",
        "chopping": "Chopping",
    }
    if fallback_label and fallback_label.lower() in simulation_threat_labels:
        label = simulation_threat_labels[fallback_label.lower()]
        return {label: 0.92}
    model = _yamnet()
    if model is not None:
        try:
            scores, _, _ = model(samples.astype(np.float32))
            values = np.asarray(scores).mean(axis=0)
            labels = _yamnet_labels(model)
            result = {_canonical_label(labels[i]): float(values[i]) for i in np.argsort(values)[-10:]}
            logger.info('YAMNet classified audio: %s', result)
            return result
        except Exception as exc:
            logger.warning('YAMNet inference failed; using fallback classifier: %s', exc)

    # Deterministic local fallback for simulator/demo development and
    # installations where the optional YAMNet dependencies are absent.
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
    features = _fallback_features(samples, sample_rate)
    rms = features['rms']
    peak = features['peak']
    # A gunshot is an impulsive event: high crest factor, a short energy
    # burst, and little sustained energy. Loudness by itself is not enough.
    if peak > 0.85 and features['crest_factor'] >= 6.0 and features['transient_ratio'] >= 3.0 and features['sustained_fraction'] < 0.25:
        return {"Gunshot": min(0.99, max(0.7, peak)), "Explosion": 0.1}
    if rms < 0.01:
        return {"Silence": 0.95}
    # Chainsaws and engines are sustained sources. The centroid separates a
    # rough, broadband chainsaw-like signal from a lower-frequency engine tone.
    if rms >= 0.02 and features['sustained_fraction'] >= 0.35:
        if features['spectral_centroid'] >= 800:
            return {"Chainsaw": min(0.95, max(0.6, rms + 0.55))}
        return {"Engine": min(0.9, max(0.55, rms + 0.45))}
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




