import { useEffect, useState } from 'react';
import useDashboardData from '../hooks/useDashboardData';
import { useLiveAudio } from '../hooks/useLiveAudio';
import { zones } from '../config/constants';

const tone = {
  success: 'border-moss-500/40 bg-moss-500/10 text-slate-700',
  pending: 'border-amber-300 bg-amber-50 text-amber-900',
  submitting: 'border-amber-300 bg-amber-50 text-amber-900',
  error: 'border-red-300 bg-red-50 text-red-800',
  neutral: 'border-slate-300 bg-slate-50 text-slate-700',
};

export default function SimulationPage({ active = true }) {
  const { queue, setQueue, loaded, simulator, selectedZone, setSelectedZone, sound, setSound, duration, setDuration, busy, error, simulationNotice, start, stop, trigger, triggerMany, sidebarBeacons, summary } = useDashboardData();
  const player = useLiveAudio();
  const workerHealthy = simulator.worker_healthy !== false && simulator.running;
  const selectedState = simulator.zones?.[selectedZone];
  const cycleTime = simulator.last_cycle_at ? new Date(simulator.last_cycle_at).toLocaleTimeString() : 'Not yet';
  const zoneHasBeacon = (selectedState?.beacon_count || 0) > 0;
  const selectedBeaconIds = selectedState?.beacon_ids || [];
  const disabledReason = !loaded.simulation ? 'Loading simulation status.' : busy ? 'A request is being submitted. Please wait.'
    : !workerHealthy ? 'Start the simulation before triggering a sound.'
    : !zoneHasBeacon ? 'This zone has no simulated beacons. Select a populated zone.' : '';
  const engineLabel = simulator.worker_phase === 'initializing' ? 'Initializing audio model - triggers will queue'
    : simulator.worker_phase === 'stopping' ? 'Finishing current capture' : workerHealthy ? 'Worker healthy' : 'Worker stopped';
  const [, setClock] = useState(Date.now());
  const snapshotAge = simulator._receivedAt ? Math.max(0, (Date.now() - simulator._receivedAt) / 1000) : 0;
  const remaining = selectedState?.remaining_seconds ? Math.max(0, Math.ceil(selectedState.remaining_seconds - snapshotAge)) : 0;

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);

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
    if (state?.phase === 'queued') return `${state.sound} queued`;
    if (state?.phase === 'processing') return `${state.sound} processing`;
    if (!state?.scenario_id || state.sound === 'ambient') return 'Ambient loop';
    const age = simulator._receivedAt ? Math.max(0, (Date.now() - simulator._receivedAt) / 1000) : 0;
    return state.sound + ' active · ' + Math.max(0, Math.ceil(state.remaining_seconds - age)) + 's left';
  };

  return (
    <main className="dashboard-content simulation-content mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-10">
      <header className="mb-7">
        <p className="mt-9 text-xs font-semibold tracking-[.22em] text-moss-400">SCENARIO LAB</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Scenario controls</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">Inject a clean recording into the same pipeline used by the monitoring dashboard.</p>
      </header>

      {!loaded.simulation && <p role="status" className="mb-4 text-sm text-slate-500">Loading simulation status…</p>}
      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {simulator.last_error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><span className="font-semibold">Worker warning:</span> {simulator.last_error}</div>}
      {simulationNotice && <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${tone[simulationNotice.kind] || tone.neutral}`}>{simulationNotice.text}</div>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl sm:p-7">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="font-semibold text-slate-900">Simulation engine</h2><p className="mt-1 text-xs text-slate-600">Every cycle creates real event records for the simulated beacons.</p></div>
          <div className="flex items-center gap-3 text-xs">
            <span className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 ${workerHealthy ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-800'}`}><span className={`h-2 w-2 rounded-full ${workerHealthy ? 'bg-emerald-500' : 'bg-red-500'}`} />{engineLabel}</span>
            <span className="text-slate-500">Last cycle: {cycleTime}</span>
          </div>
        </div>
        <div className="mb-7 flex gap-3"><button onClick={start} disabled={!loaded.simulation || busy || workerHealthy} className="flex-1 rounded-lg bg-moss-500 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">Start simulation</button><button onClick={stop} disabled={!loaded.simulation || busy || !simulator.running} className="flex-1 rounded-lg border border-slate-300 px-4 py-3 text-sm text-slate-600 disabled:opacity-40">Stop simulation</button></div>
        <div className="grid gap-5 md:grid-cols-2">
          <label className="text-xs text-slate-600">Selected zone<select aria-label="Selected zone" value={selectedZone} onChange={(event) => setSelectedZone(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900">{zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.id} ({simulator.zones?.[zone.id]?.beacon_count || 0} simulated beacons)</option>)}</select></label>
          <label className="text-xs text-slate-600">Sound<select aria-label="Sound" value={sound} onChange={(event) => setSound(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900"><option value="ambient">ambient</option><optgroup label="Threat sounds">{['chainsaw', 'gunshot', 'vehicle', 'engine', 'chopping'].map((item) => <option key={item}>{item}</option>)}</optgroup><optgroup label="Forest test sounds">{['birds', 'frogs', 'insects', 'rain', 'wind', 'monkey'].map((item) => <option key={item}>{item}</option>)}</optgroup></select><span className="mt-2 block text-[11px] text-slate-500">{sound === 'ambient' ? 'Using the ambient forest recording' : (simulator.available_threat_sounds?.includes(sound) || simulator.available_test_sounds?.includes(sound)) ? 'Using downloaded recording' : 'Using generated fallback until a matching WAV is added'}</span></label>
          <label className="text-xs text-slate-600">Duration<select aria-label="Duration" value={duration} onChange={(event) => setDuration(event.target.value)} className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-3 text-sm text-slate-900">{[10, 30, 60, 120].map((item) => <option key={item} value={item}>{item}s</option>)}</select></label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-600"><span className="font-semibold text-slate-800">Selected zone state</span><span className="mt-1 block">{stateLabel(selectedZone)}</span>{selectedBeaconIds.length > 0 && <span className="mt-1 block">Beacons: {selectedBeaconIds.join(', ')}</span>}{selectedBeaconIds.length > 1 && <span className="mt-1 block text-amber-700">Multiple beacons receive this scenario.</span>}</div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2"><button onClick={trigger} aria-describedby="trigger-reason" disabled={Boolean(disabledReason)} className="simulation-trigger rounded-lg bg-[#1F3D2B] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">{simulationNotice?.kind === 'submitting' ? 'Submitting...' : 'Trigger ' + sound + ' now'}</button><button onClick={addToQueue} disabled={!loaded.simulation || busy || !workerHealthy || !zoneHasBeacon} className="rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-40">Add to trigger queue</button></div>
        <p id="trigger-reason" aria-live="polite" className="mt-3 text-xs text-slate-600">{disabledReason || `Ready to trigger at ${selectedBeaconIds.join(', ')}. Listening selection will stay unchanged.`}</p>
        {simulationNotice?.scenarios?.map((item) => <button key={item.scenario_id} type="button" onClick={() => player?.listenTo(item.beacon_ids[0])} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">Listen to {item.beacon_ids[0]}</button>)}
      </section>

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">Trigger queue</h2><p className="mt-1 text-xs text-slate-500">Queue different sounds in different zones and run them together.</p></div><button onClick={runQueue} disabled={!loaded.simulation || busy || !workerHealthy || queue.length === 0} className="rounded-lg bg-[#1F3D2B] px-4 py-2 text-xs font-semibold text-white disabled:opacity-60">Trigger all ({queue.length})</button></div>
        {queue.length === 0 ? <p className="rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">No queued scenarios yet.</p> : <div className="space-y-2">{queue.map((item, index) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{index + 1}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-slate-800">{item.sound}</span><span className="block text-xs text-slate-500">{item.zone} · {item.duration}s</span></span><button onClick={() => removeFromQueue(item.id)} className="text-xs font-semibold text-slate-500 hover:text-red-700">Remove</button></div>)}</div>}
      </section>
      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"><h2 className="mb-4 font-semibold text-slate-900">Zone activity</h2><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{zones.map((zone) => { const state = simulator.zones?.[zone.id]; return <button key={zone.id} onClick={() => setSelectedZone(zone.id)} className={`rounded-xl border p-4 text-left ${selectedZone === zone.id ? 'border-warning ring-1 ring-warning' : 'border-slate-200'} ${state?.threat ? 'bg-red-50 text-red-800' : 'bg-slate-50/60 text-slate-600'}`}><span className="block text-xs font-semibold">{zone.id}</span><span className="mt-2 block text-[11px]">{stateLabel(zone.id)}</span></button>; })}</div></section>
      <p className="mt-4 text-xs text-slate-500">Simulation-only demonstration controls. The physical ESP32 beacon is tested locally.</p>
    </main>
  );
}


