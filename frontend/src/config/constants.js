export const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';
export const BOUNDS = { min_lat: -4.15, max_lat: -3.85, min_lon: -55.20, max_lon: -54.90 };
export const THREAT_THRESHOLD = 0.45;

export const zones = Array.from({ length: 16 }, (_, index) => {
  const row = Math.floor(index / 4);
  const col = index % 4;
  const latStep = (BOUNDS.max_lat - BOUNDS.min_lat) / 4;
  const lonStep = (BOUNDS.max_lon - BOUNDS.min_lon) / 4;
  return {
    id: `zone_${row}_${col}`,
    bounds: [
      [BOUNDS.min_lat + row * latStep, BOUNDS.min_lon + col * lonStep],
      [BOUNDS.min_lat + (row + 1) * latStep, BOUNDS.min_lon + (col + 1) * lonStep],
    ],
  };
});