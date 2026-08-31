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
      <div className="mt-4 flex min-h-[300px] items-center justify-center rounded-xl bg-slate-50/70 text-sm text-slate-500">No ACI history for this beacon yet.</div>
    </div>;
  }
  

  const values = data.map((item) => Number(item.aci_value) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pointList = data.map((item, index) => {
    const x = pad + index * ((width - pad * 2) / Math.max(1, data.length - 1));
    const y = height - pad - ((Number(item.aci_value) - min) / span) * (height - pad * 2);
    return `${x},${y}`;
  });
  const points = pointList.join(' ');

  return <div className="aci-chart-card min-h-[430px] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
    <div className="flex items-start justify-between gap-3">
      <div><p className="text-[10px] font-semibold tracking-[.16em] text-moss-500">ACI TREND</p><h2 className="mt-1 text-lg font-semibold text-slate-900">Acoustic complexity</h2><p className="mt-1 text-xs text-slate-500">Soundscape activity over recent detections</p></div>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold text-slate-600">{beaconId || 'All beacons'}</span>
    </div>
    <div className="mt-5 rounded-xl bg-slate-50/80 p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[285px] w-full" role="img" aria-label="Acoustic complexity trend">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#DAD7CD" />
        <line x1={pad} y1={pad} x2={width - pad} y2={pad} stroke="#E8E6DF" />
        <polyline points={points} fill="none" stroke="#588157" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {pointList.map((point, index) => { const [x, y] = point.split(','); return <circle key={index} cx={x} cy={y} r="4" fill="#588157" stroke="#FFFFFF" strokeWidth="2" />; })}
      </svg>
    </div>
    <div className="mt-3 flex justify-between text-[10px] font-medium text-slate-500"><span>Low {min.toFixed(2)}</span><span>{data.length} readings</span><span>High {max.toFixed(2)}</span></div>
  </div>;
}
