export function formatHealth(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Number(value.toFixed(1))}%` : '\u2014';
}

export function healthStatus(summary) {
  if (summary.loading) return 'Loading forest health...';
  const observed = summary.observed_zone_count || 0;
  const affected = summary.affected_zone_count || 0;
  if (!observed || summary.forest_health_score == null) return 'Waiting for recent audio';
  if (affected) return `${affected} ${affected === 1 ? 'zone' : 'zones'} affected`;
  return 'No active threats detected';
}

export function HealthOverview({ summary, loading = false }) {
  const observed = summary.observed_zone_count || 0;
  const populated = summary.populated_zone_count || 0;
  return <div className="mt-2 space-y-1 text-xs text-slate-500" aria-live="polite">
    <p>{loading ? 'Loading...' : observed ? `${observed} zones monitored` : 'Waiting for recent audio'}</p>
    {!loading && summary.affected_zone_count > 0 && <p data-testid="health-impact" className="font-semibold text-warning">
      {summary.affected_zone_count} {summary.affected_zone_count === 1 ? 'zone' : 'zones'} affected
    </p>}
    {!loading && observed < populated && <p data-testid="health-coverage">Limited coverage: {observed} of {populated} zones reporting</p>}
  </div>;
}
