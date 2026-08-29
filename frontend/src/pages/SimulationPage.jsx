import DashboardShell from '../components/DashboardShell';
import useDashboardData from '../hooks/useDashboardData';
import { zones } from '../config/constants';

const tone = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
};

export default function SimulationPage() {
  const { simulator, selectedZone, setSelectedZone, sound, setSound, duration, setDuration, busy, error, simulationNotice, start, stop, trigger, sidebarBeacons, summary } = useDashboardData();
  const workerHealthy = simulator.worker_healthy !== false && simulator.running;
  const selectedState = simulator.zones?.[selectedZone];
  const cycleTime = simulator.last_cycle_at ? new Date(simulator.last_cycle_at).toLocaleTimeString() : 'Not yet';
  const zoneHasBeacon = (selectedState?.beacon_count || 0) > 0;

  return <DashboardShell variant="simulation" sidebarHealth={summary.forest_health_score} sidebarSummary={summary} sidebarBeacons={sidebarBeacons}>
    <main className="dashboard-content simulation-content mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <header className="mb-7">
        <p className="mt-9 text-xs font-semibold tracking-[.22em] text-moss-400">SCENARIO LAB</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Scenario controls</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">Inject a clean recording into the same pipeline used by the monitoring dashboard.</p>
      </header>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {simulator.last_error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span className="font-semibold">Worker warning:</span> {simulator.last_error}</div>}
      {simulationNotice && <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${tone[simulationNotice.kind] || tone.neutral}`}>{simulationNotice.text}</div>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-7">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="font-semibold text-slate-900">Simulation engine</h2><p className="mt-1 text-xs text-slate-600">Every cycle creates real event records for the simulated beacons.</p></div>
          <div className="flex items-center gap-3 text-xs">
            <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 ${workerHealthy ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}><span className={`h-2 w-2 rounded-full ${workerHealthy ? 'bg-emerald-500' : 'bg-red-500'}`} />{workerHealthy ? 'Worker healthy' : 'Worker stopped'}</span>
            <span className="text-slate-500">Last cycle: {cycleTime}</span>
          </div>
        </div>
        <div className="mb-7 flex gap-3"><button onClick={start} disabled={busy || workerHealthy} className="flex-1 rounded-lg bg-moss-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">Start simulation</button><button onClick={stop} disabled={busy || !simulator.running} className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-sm text-slate-600 disabled:opacity-40">Stop simulation</button></div>
        <div className="grid gap-5 md:grid-cols-2">
          <label className="text-xs text-slate-600">Selected zone<select value={selectedZone} onChange={(event) => setSelectedZone(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900">{zones.map((zone) => <option key={zone.id}>{zone.id}</option>)}</select></label>
          <label className="text-xs text-slate-600">Sound<select value={sound} onChange={(event) => setSound(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900"><optgroup label="Threat sounds">{['chainsaw', 'gunshot', 'vehicle', 'engine', 'chopping'].map((item) => <option key={item}>{item}</option>)}</optgroup><optgroup label="Forest test sounds">{['birds', 'frogs', 'insects', 'rain', 'wind', 'monkey'].map((item) => <option key={item}>{item}</option>)}</optgroup></select><span className="mt-2 block text-[11px] text-slate-500">{(simulator.available_threat_sounds?.includes(sound) || simulator.available_test_sounds?.includes(sound)) ? 'Using downloaded recording' : 'Using generated fallback until a matching WAV is added'}</span></label>
          <label className="text-xs text-slate-600">Duration<select value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900">{[10, 30, 60, 120].map((item) => <option key={item} value={item}>{item}s</option>)}</select></label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600"><span className="font-semibold text-slate-800">Selected zone state</span><span className="mt-1 block">{selectedState?.threat ? `${selectedState.sound} active · ${selectedState.remaining_seconds}s left` : 'Ambient loop'}</span></div>
        </div>
        <button onClick={trigger} disabled={busy || !workerHealthy || !zoneHasBeacon} className="mt-6 w-full rounded-lg bg-threat px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Sending trigger…' : `Trigger ${sound} in ${selectedZone}`}</button>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"><h2 className="mb-4 font-semibold text-slate-900">Zone activity</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{zones.map((zone) => { const state = simulator.zones?.[zone.id]; return <button key={zone.id} onClick={() => setSelectedZone(zone.id)} className={`rounded-xl border p-4 text-left ${selectedZone === zone.id ? 'border-warning ring-1 ring-warning' : 'border-slate-200'} ${state?.threat ? 'bg-red-50 text-red-800' : 'bg-slate-50/60 text-slate-600'}`}><span className="block text-xs font-semibold">{zone.id}</span><span className="mt-2 block text-[11px]">{state?.threat ? `${state.sound} active · ${state.remaining_seconds}s` : 'Ambient loop'}</span></button>; })}</div></section>
      <p className="mt-4 text-xs text-slate-500">Simulation-only demonstration controls. The physical ESP32 beacon is tested locally.</p>
    </main>
  </DashboardShell>;
}


