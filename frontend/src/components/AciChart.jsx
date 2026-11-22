export default function AciChart({ data, beaconId }) {
  const width = 640;
  const height = 230;
  const pad = 24;

  if (!data.length) {
    return <div className="aci-chart-card min-h-[430px] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[10px] font-semibold tracking-[.16em] text-moss-500">ACI TREND</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Acoustic complexity</h2></div>
        <span className="rounded-xl bg-slate-100 px-3 py-1 text-[10px] font-semibold text-slate-500">{beaconId || 'No beacon selected'}</span>
      </div>
      <div className="mt-4 flex min-h-[300px] items-center justify-center rounded-xl text-sm text-slate-500">No ACI history for this beacon yet.</div>
    </div>;
  }


  const values = data.map((item) => Number(item.aci_value) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const plotLeft = 52;
  // Work in hundredths so tick boundaries stay stable between refreshes.
  const spread = (max - min) * 100;
  const step = [1, 2, 5, 10, 20, 25].find(size => size * 4 >= spread) ?? 25;
  const center = (min + max) * 50;
  const lower = Math.max(0, Math.floor(Math.min(min * 100, center - 2 * step) / step) * step);
  const upper = Math.min(100, Math.ceil(Math.max(max * 100, center + 2 * step) / step) * step);
  const ticks = Array.from({ length: (upper - lower) / step + 1 }, (_, i) => (lower + i * step) / 100);
  const yForAci = value => height - pad - (value * 100 - lower) / (upper - lower) * (height - pad * 2);
  const spacing = (width - pad - plotLeft) / Math.max(1, values.length - 1);
  const points = values.map((value, index) => ({
    x: plotLeft + index * spacing,
    y: yForAci(value),
  }));
  // With equally spaced readings, harmonic-mean tangents keep each segment
  // within its endpoints and flatten the curve at local peaks and troughs.
  const tangents = points.map(({ y }, i) => {
    if (points.length === 1) return 0;
    if (i === 0) return points[1].y - y;
    const before = y - points[i - 1].y;
    if (i === points.length - 1) return before;
    const after = points[i + 1].y - y;
    return before * after > 0 ? 2 * before * after / (before + after) : 0;
  });
  const curve = points.map(({ x, y }, i) => {
    if (i === 0) return `M ${x} ${y}`;
    const prev = points[i - 1];
    return `C ${prev.x + spacing / 3} ${prev.y + tangents[i - 1] / 3}, ${x - spacing / 3} ${y - tangents[i] / 3}, ${x} ${y}`;
  }).join(' ');
  const latest = points[points.length - 1];

  return <div className="aci-chart-card min-h-[430px] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-[10px] font-semibold tracking-[.16em] text-moss-500">ACI TREND</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Acoustic complexity</h2><p className="mt-1 text-xs text-slate-500">Soundscape activity over recent detections</p></div>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold text-slate-600">{beaconId || 'All beacons'}</span>
    </div>
    <div className="mt-5 rounded-xl p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[285px] w-full" role="img" aria-label={`Acoustic complexity trend, ACI axis from ${lower / 100} to ${upper / 100}`}>
        {ticks.map(tick => (
          <g key={tick} transform={`translate(0 ${yForAci(tick)})`}>
            <line x1={plotLeft} x2={width - pad} stroke="#344e41" strokeOpacity=".14" />
            <line x1={plotLeft - 4} x2={plotLeft} stroke="#708477" />
            <text x={plotLeft - 9} dy=".35em" textAnchor="end" fill="#4e6356" fontSize="14">{tick.toFixed(2)}</text>
          </g>
        ))}
        <path d={curve} fill="none" stroke="#386246" strokeWidth="3" strokeLinecap="round" />
        <circle cx={latest.x} cy={latest.y} r="3.5" fill="#386246" />
      </svg>
    </div>
    <div className="mt-3 flex justify-between text-[10px] font-medium text-slate-500"><span>Low {min.toFixed(2)}</span><span>{data.length} readings</span><span>High {max.toFixed(2)}</span></div>
  </div>;
}
