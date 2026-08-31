import pytest

from app.scoring import fuse, get_zone, threat_score


def test_threat_score_uses_weighted_confidence():
    label, confidence, score = threat_score({"Chainsaw": 0.8, "Wind": 0.99})
    assert label == "Wind"
    assert confidence == 0.99
    assert score == pytest.approx(0.72)


def test_fusion_combines_threat_and_aci_drop():
    final, drop = fuse(0.8, 0.5, 1.0)
    assert drop == 0.5
    assert final == pytest.approx(0.71)


def test_zone_max_boundary_is_inside_grid():
    bounds = {"min_lat": -4.05, "max_lat": -3.95, "min_lon": -55.10, "max_lon": -55.00}
    assert get_zone(-3.95, -55.00, bounds) == "zone_3_3"
    assert get_zone(-4.05, -55.10, bounds) == "zone_0_0"

def test_low_confidence_threat_is_neutral():
    label, confidence, score = threat_score({'Chainsaw': 0.50}, min_threat_confidence=0.70)
    assert label == 'Noise'
    assert confidence == pytest.approx(0.50)
    assert score == 0.0

def test_confident_threat_passes_gate():
    label, confidence, score = threat_score({'Chainsaw': 0.70}, min_threat_confidence=0.70)
    assert label == 'Chainsaw'
    assert confidence == pytest.approx(0.70)
    assert score == pytest.approx(0.63)
