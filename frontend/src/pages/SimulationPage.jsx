import { CaretLeft, CaretRight, Radio, SlidersHorizontal, SquaresFour, Waveform as WaveformIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import useDashboardData from '../hooks/useDashboardData';
import { zones } from '../config/constants';

function SkeletonBlock({ className = '' }) {
  return <span aria-hidden="true" className={`dashboard-skeleton-block ${className}`} />;
}
function SimulationLoadingSkeleton() {
  const placeholderBeacons = ['BEACON_01', 'BEACON_02', 'BEACON_03', 'BEACON_04'];
  return <div className="dashboard-boot simulation-boot min-h-screen" aria-busy="true" aria-label="Preparing scenario lab">
    <aside className="dashboard-boot-sidebar"><div className="dashboard-boot-sidebar-header overflow-hidden bg-white"><img src="/logo.png" alt="Foresight" className="dashboard-boot-logo" /><button type="button" aria-label="Collapse information panel" className="dashboard-boot-icon-button"><CaretLeft weight="duotone" size={16} /></button></div><div className="dashboard-boot-sidebar-content"><div className="dashboard-boot-health"><div className="flex items-center justify-between"><span className="dashboard-boot-static-label">FOREST HEALTH</span><Radio weight="duotone" size={16} className="text-moss-500" /></div><SkeletonBlock className="mt-3 h-11 w-32" /><SkeletonBlock className="mt-3 h-2 w-28" /></div><div className="mt-3 grid grid-cols-2 gap-2"><SkeletonBlock className="h-16 w-full" /><SkeletonBlock className="h-16 w-full" /></div><div className="mt-6 flex items-center justify-between"><span className="dashboard-boot-static-label">BEACONS</span><SkeletonBlock className="h-2 w-12" /></div><div className="mt-3 space-y-2">{placeholderBeacons.map((beacon) => <div key={beacon} className="dashboard-boot-beacon"><span className="h-2 w-2 rounded-full bg-moss-300" /><div className="min-w-0 flex-1"><SkeletonBlock className="h-2 w-20" /><SkeletonBlock className="mt-2 h-2 w-14" /></div><WaveformIcon weight="duotone" size={13} className="text-slate-400" /></div>)}</div></div></aside>
    <main className="dashboard-boot-main"><header className="dashboard-boot-topbar"><nav className="flex items-center gap-1 "><span className="dashboard-boot-nav-link"><SquaresFour weight="duotone" size={14} /> Monitor</span><span className="dashboard-boot-nav-link"><SlidersHorizontal weight="duotone" size={14} /> Scenarios</span></nav></header><div className="dashboard-boot-content simulation-boot-content"><div><span className="dashboard-boot-static-label">SCENARIO LAB</span><SkeletonBlock className="mt-3 h-9 w-56" /><SkeletonBlock className="mt-3 h-2 w-full max-w-xl" /></div><section className="dashboard-boot-card mt-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><SkeletonBlock className="h-4 w-36" /><SkeletonBlock className="mt-3 h-2 w-64" /></div><div className="flex items-center gap-3"><SkeletonBlock className="h-7 w-28" /><SkeletonBlock className="h-2 w-28" /></div></div><div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" className="dashboard-boot-static-button"><span className="dashboard-boot-static-icon"><Radio weight="duotone" size={15} /></span> Start simulation</button><button type="button" className="dashboard-boot-static-button dashboard-boot-static-button-muted"><span className="dashboard-boot-static-icon"><CaretRight weight="duotone" size={15} /></span> Stop simulation</button></div><div className="mt-6 grid gap-5 md:grid-cols-2"><div><span className="dashboard-boot-static-label">SELECTED ZONE</span><SkeletonBlock className="mt-2 h-11 w-full" /></div><div><span className="dashboard-boot-static-label">SOUND</span><SkeletonBlock className="mt-2 h-11 w-full" /></div><div><span className="dashboard-boot-static-label">DURATION</span><SkeletonBlock className="mt-2 h-11 w-full" /></div><div className="dashboard-boot-card dashboard-boot-inner-card"><SkeletonBlock className="h-3 w-32" /><SkeletonBlock className="mt-3 h-2 w-24" /></div></div><div className="mt-6 grid gap-3 sm:grid-cols-2"><button type="button" className="dashboard-boot-static-button dashboard-boot-static-button-primary"><Radio weight="duotone" size={15} /> Trigger sound now</button><button type="button" className="dashboard-boot-static-button dashboard-boot-static-button-muted"><span className="text-lg leading-none">+</span> Add to trigger queue</button></div></section><section className="dashboard-boot-card mt-4"><div className="flex items-center justify-between"><div><SkeletonBlock className="h-4 w-28" /><SkeletonBlock className="mt-3 h-2 w-64" /></div><SkeletonBlock className="h-8 w-28" /></div><div className="mt-5 grid gap-2 sm:grid-cols-2"><SkeletonBlock className="h-14 w-full" /><SkeletonBlock className="h-14 w-full" /></div></section><section className="dashboard-boot-card mt-4"><SkeletonBlock className="h-4 w-28" /><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="dashboard-boot-zone"><SkeletonBlock className="h-3 w-20" /><SkeletonBlock className="mt-3 h-2 w-24" /></div>)}</div></section></div></main>
  </div>;
}
const tone = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  pending: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
};

export default function SimulationPage() {
  const { initialLoading, simulator, selectedZone, setSelectedZone, sound, setSound, duration, setDuration, busy, error, simulationNotice, start, stop, trigger, triggerMany, sidebarBeacons, summary } = useDashboardData();
  const workerHealthy = simulator.worker_healthy !== false && simulator.running;
  const selectedState = simulator.zones?.[selectedZone];
  const cycleTime = simulator.last_cycle_at ? new Date(simulator.last_cycle_at).toLocaleTimeString() : 'Not yet';
  const zoneHasBeacon = (selectedState?.beacon_count || 0) > 0;
  const [queue, setQueue] = useState([]);
  const [bootStartedAt] = useState(() => Date.now());
  const [revealReady, setRevealReady] = useState(false);
  const [, setClock] = useState(Date.now());
  const snapshotAge = simulator._receivedAt ? Math.max(0, (Date.now() - simulator._receivedAt) / 1000) : 0;
  const remaining = selectedState?.remaining_seconds ? Math.max(0, Math.ceil(selectedState.remaining_seconds - snapshotAge)) : 0;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

useEffect(() => {
    if (initialLoading) return undefined;
    const remaining = Math.max(0, 900 - (Date.now() - bootStartedAt));
    const timer = window.setTimeout(() => setRevealReady(true), remaining);
    return () => window.clearTimeout(timer);
  }, [initialLoading, bootStartedAt]);
  if (initialLoading || !revealReady) return <SimulationLoadingSkeleton />;
  const addToQueue = () => {
    if (!zoneHasBeacon) return;
    setQueue((items) => [...items, { id: selectedZone + '-' + Date.now() + '-' + Math.random(), zone: selectedZone, sound, duration: Number(duration) }]);
  };
  const removeFromQueue = (id) => setQueue((items) => items.filter((item) => item.id !== id));
  const runQueue = async () => {
    const result = await triggerMany(queue);
    if (result) setQueue([]);
  };
  const stateLabel = (zoneId) => {
    const state = simulator.zones?.[zoneId];
    if (!state?.threat) return 'Ambient loop';
    const age = simulator._receivedAt ? Math.max(0, (Date.now() - simulator._receivedAt) / 1000) : 0;
    return state.sound + ' active · ' + Math.max(0, Math.ceil(state.remaining_seconds - age)) + 's left';
  };

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
            <span className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 ${workerHealthy ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}><span className={`h-2 w-2 rounded-full ${workerHealthy ? 'bg-emerald-500' : 'bg-red-500'}`} />{workerHealthy ? 'Worker healthy' : 'Worker stopped'}</span>
            <span className="text-slate-500">Last cycle: {cycleTime}</span>
          </div>
        </div>
        <div className="mb-7 flex gap-3"><button onClick={start} disabled={busy || workerHealthy} className="flex-1 rounded-lg bg-moss-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">Start simulation</button><button onClick={stop} disabled={busy || !simulator.running} className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-sm text-slate-600 disabled:opacity-40">Stop simulation</button></div>
        <div className="grid gap-5 md:grid-cols-2">
          <label className="text-xs text-slate-600">Selected zone<select value={selectedZone} onChange={(event) => setSelectedZone(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900">{zones.map((zone) => <option key={zone.id}>{zone.id}</option>)}</select></label>
          <label className="text-xs text-slate-600">Sound<select value={sound} onChange={(event) => setSound(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900"><option value="ambient">ambient</option><optgroup label="Threat sounds">{['chainsaw', 'gunshot', 'vehicle', 'engine', 'chopping'].map((item) => <option key={item}>{item}</option>)}</optgroup><optgroup label="Forest test sounds">{['birds', 'frogs', 'insects', 'rain', 'wind', 'monkey'].map((item) => <option key={item}>{item}</option>)}</optgroup></select><span className="mt-2 block text-[11px] text-slate-500">{sound === 'ambient' ? 'Using the ambient forest recording' : (simulator.available_threat_sounds?.includes(sound) || simulator.available_test_sounds?.includes(sound)) ? 'Using downloaded recording' : 'Using generated fallback until a matching WAV is added'}</span></label>
          <label className="text-xs text-slate-600">Duration<select value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900">{[10, 30, 60, 120].map((item) => <option key={item} value={item}>{item}s</option>)}</select></label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600"><span className="font-semibold text-slate-800">Selected zone state</span><span className="mt-1 block">{selectedState?.threat ? selectedState.sound + ' active · ' + remaining + 's left' : 'Ambient loop'}</span></div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2"><button onClick={trigger} disabled={busy || !workerHealthy || !zoneHasBeacon} className="rounded-lg bg-[#1F3D2B] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Sending trigger…' : 'Trigger ' + sound + ' now'}</button><button onClick={addToQueue} disabled={busy || !workerHealthy || !zoneHasBeacon} className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-40">Add to trigger queue</button></div>
      </section>

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">Trigger queue</h2><p className="mt-1 text-xs text-slate-500">Queue different sounds in different zones and run them together.</p></div><button onClick={runQueue} disabled={busy || !workerHealthy || queue.length === 0} className="rounded-lg bg-[#1F3D2B] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">Trigger all ({queue.length})</button></div>
        {queue.length === 0 ? <p className="rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">No queued scenarios yet.</p> : <div className="space-y-2">{queue.map((item, index) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{index + 1}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-800">{item.sound}</span><span className="block text-xs text-slate-500">{item.zone} · {item.duration}s</span></span><button onClick={() => removeFromQueue(item.id)} className="text-xs font-semibold text-slate-500 hover:text-red-700">Remove</button></div>)}</div>}
      </section>
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"><h2 className="mb-4 font-semibold text-slate-900">Zone activity</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{zones.map((zone) => { const state = simulator.zones?.[zone.id]; return <button key={zone.id} onClick={() => setSelectedZone(zone.id)} className={`rounded-xl border p-4 text-left ${selectedZone === zone.id ? 'border-warning ring-1 ring-warning' : 'border-slate-200'} ${state?.threat ? 'bg-red-50 text-red-800' : 'bg-slate-50/60 text-slate-600'}`}><span className="block text-xs font-semibold">{zone.id}</span><span className="mt-2 block text-[11px]">{stateLabel(zone.id)}</span></button>; })}</div></section>
      <p className="mt-4 text-xs text-slate-500">Simulation-only demonstration controls. The physical ESP32 beacon is tested locally.</p>
    </main>
  </DashboardShell>;
}


