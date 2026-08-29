import numpy as np

from app import audio


def test_sustained_loud_chainsaw_like_audio_is_not_gunshot(monkeypatch):
    monkeypatch.setattr(audio, '_yamnet', lambda: None)
    sample_rate = 16_000
    t = np.arange(sample_rate * 2) / sample_rate
    samples = (0.35 * np.sin(2 * np.pi * 110 * t) + 0.12 * np.random.default_rng(4).normal(size=len(t))).astype(np.float32)
    samples = np.clip(samples * 3.0, -1.0, 1.0)

    result = audio.classify(samples, sample_rate)

    assert max(result, key=result.get) in {'Chainsaw', 'Engine'}
    assert 'Gunshot' not in result


def test_short_impulse_can_be_gunshot(monkeypatch):
    monkeypatch.setattr(audio, '_yamnet', lambda: None)
    samples = np.random.default_rng(5).normal(0, 0.01, 16_000).astype(np.float32)
    samples[:500] += np.linspace(0, 1.0, 500, dtype=np.float32)

    result = audio.classify(samples)

    assert 'Gunshot' in result
