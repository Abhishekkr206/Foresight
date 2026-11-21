import numpy as np

from app import audio


def test_sustained_loud_chainsaw_like_audio_is_not_gunshot(monkeypatch):
    monkeypatch.setattr(audio, '_yamnet', lambda: None)
    sample_rate = 16_000
    t = np.arange(sample_rate * 2) / sample_rate
    samples = (0.35 * np.sin(2 * np.pi * 110 * t) + 0.12 * np.random.default_rng(4).normal(size=len(t))).astype(np.float32)
    samples = np.clip(samples * 3.0, -1.0, 1.0)

    result = audio.classify(samples, sample_rate)

    assert max(result, key=result.get) == 'Noise'
    assert 'Gunshot' not in result


def test_short_impulse_can_be_gunshot(monkeypatch):
    monkeypatch.setattr(audio, '_yamnet', lambda: None)
    samples = np.random.default_rng(5).normal(0, 0.01, 16_000).astype(np.float32)
    samples[:500] += np.linspace(0, 1.0, 500, dtype=np.float32)

    result = audio.classify(samples)

    assert 'Gunshot' in result


def test_explicit_simulation_chainsaw_remains_deterministic():
    samples = np.zeros(16_000, dtype=np.float32)

    result = audio.classify(samples, fallback_label='chainsaw')

    assert result == {'Chainsaw': 0.92}


def test_lite_interpreter_is_serialized_across_capture_threads(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    import time

    class Interpreter:
        active = False
        overlap = False

        def get_input_details(self):
            return [{'index': 0}]

        def resize_tensor_input(self, *args, **kwargs):
            if self.active:
                self.overlap = True
            self.active = True

        def allocate_tensors(self):
            pass

        def set_tensor(self, *args):
            pass

        def invoke(self):
            time.sleep(0.01)

        def get_output_details(self):
            return [{'index': 1}]

        def get_tensor(self, *args):
            self.active = False
            return np.array([[0.1, 0.9]], dtype=np.float32)

    interpreter = Interpreter()
    monkeypatch.setattr(audio, 'CLASSIFIER_BACKEND', 'lite')
    monkeypatch.setattr(audio, '_lite_yamnet', lambda: interpreter)
    monkeypatch.setattr(audio, '_lite_yamnet_labels', lambda: ['Wind', 'Chainsaw'])
    with ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(audio.classify, [np.zeros(16000, dtype=np.float32)] * 8))
    assert not interpreter.overlap
    assert all(max(result, key=result.get) == 'Chainsaw' for result in results)
