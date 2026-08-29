from dataclasses import dataclass


THREAT_WEIGHTS: dict[str, float] = {
    "Chainsaw": 0.9,
    "Gunshot": 1.0,
    "Explosion": 1.0,
    "Vehicle": 0.6,
    "Engine": 0.5,
    "Chopping": 0.7,
    "Bird vocalization": 0.0,
    "Wind": 0.0,
    "Silence": 0.0,
}


def threat_score(confidence_by_class: dict[str, float]) -> tuple[str, float, float]:
    if not confidence_by_class:
        return "Silence", 0.0, 0.0
    label, confidence = max(confidence_by_class.items(), key=lambda pair: pair[1])
    score = max(
        max(0.0, min(1.0, value)) * THREAT_WEIGHTS.get(name, 0.0)
        for name, value in confidence_by_class.items()
    )
    return label, max(0.0, min(1.0, confidence)), max(0.0, min(1.0, score))


def fuse(threat: float, aci_value: float, aci_baseline: float) -> tuple[float, float]:
    if aci_baseline <= 0:
        raise ValueError("aci_baseline must be positive")
    aci_drop = max(0.0, aci_baseline - aci_value) / aci_baseline
    return max(0.0, min(1.0, 0.7 * threat + 0.3 * aci_drop)), aci_drop


def get_zone(lat: float, lon: float, bounds: dict[str, float], grid_size: int = 4) -> str:
    lat_step = (bounds["max_lat"] - bounds["min_lat"]) / grid_size
    lon_step = (bounds["max_lon"] - bounds["min_lon"]) / grid_size
    row = int((lat - bounds["min_lat"]) / lat_step)
    col = int((lon - bounds["min_lon"]) / lon_step)
    return f"zone_{min(grid_size - 1, max(0, row))}_{min(grid_size - 1, max(0, col))}"
