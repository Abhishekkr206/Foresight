export default function AciChart({ data }) {
  const width = 520;
  const height = 150;
  const pad = 18;
  if (!data.length) return <div className="flex h-[150px] items-center justify-center rounded-xl bg-slate-50/60 text-sm text-slate-500">No ACI history for this beacon yet.</div>;
  const values = data.map((item) => Number(item.aci_value) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = data.map((item, index) => {
    const x = pad + index * ((width - pad * 2) / Math.max(1, data.length - 1));
    const y = height - pad - ((item.aci_value - min) / span) * (height - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  return <div className="rounded-xl bg-slate-50/60 p-3"><svg viewBox={`0 0 ${width} ${height}`} className="h-[150px] w-full"><line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#A3B18A" /><polyline points={points} fill="none" stroke="#588157" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{data.map((item, index) => { const [x, y] = points.split(' ')[index].split(','); return <circle key={index} cx={x} cy={y} r="3" fill="#588157" />; })}</svg><div className="flex justify-between text-[10px] text-slate-500"><span>Low {min.toFixed(2)}</span><span>High {max.toFixed(2)}</span></div></div>;
}