import { useState } from 'react';
import DashboardShell from '../components/DashboardShell';
import AssistantPanel from '../components/AssistantPanel';
import AciChart from '../components/AciChart';
import BeaconMap from '../components/BeaconMap';
import Waveform from '../components/Waveform';
import useDashboardData from '../hooks/useDashboardData';

function EventActivity({ events, selectedEvent, highlightedEvents, filterBeacon, setFilterBeacon, filterLevel, setFilterLevel, confirmedOnly, setConfirmedOnly, beacons, activeThreats, onSelect }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Event activity</h2><div className="flex flex-wrap gap-2">
      <select value={filterBeacon} onChange={(event) => setFilterBeacon(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"><option value="all">All beacons</option>{beacons.map((beacon) => <option key={beacon.beacon_id}>{beacon.beacon_id}</option>)}</select>
      <select value={filterLevel} onChange={(event) => setFilterLevel(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"><option value="all">All severity</option><option value="normal">Normal</option><option value="threat">Threat</option><option value="high">High</option></select>
      <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={confirmedOnly} onChange={(event) => setConfirmedOnly(event.target.checked)} /> Confirmed</label>
    </div></div>
    {events.length === 0 ? <div className="rounded-xl bg-slate-100 p-6 text-sm text-slate-600">{activeThreats ? 'No matching events.' : 'All clear, no acoustic threats detected'}</div> : <div className="max-h-[360px] overflow-auto">{events.map((event) => <button key={event.id} onClick={() => onSelect(event)} className={`flex w-full flex-wrap items-center gap-3 border-t border-slate-200 py-3 text-left transition hover:bg-slate-50 ${selectedEvent?.event?.id === event.id ? 'bg-slate-100' : highlightedEvents.includes(event.id) ? 'bg-moss-500/10' : ''}`}><span className={`h-2.5 w-2.5 rounded-full ${event.final_score >= 0.75 ? 'bg-threat' : event.final_score >= 0.45 ? 'bg-warning' : 'bg-moss-500'}`}></span><span className="min-w-[120px] flex-1"><span className="block text-sm font-medium text-slate-900">{event.sound_class}</span><span className="mt-1 block text-xs text-slate-600">{event.beacon_id} / {new Date(event.timestamp).toLocaleTimeString()}</span></span><span className="text-sm font-semibold text-warning">{Math.round(event.final_score * 100)}%</span>{event.is_confirmed && <span className="rounded-full border border-moss-500/50 px-2 py-1 text-[10px] text-moss-500">Confirmed</span>}</button>)}</div>}
  </div>;
}

function SelectedEvent({ selectedEvent, correlation, setSelectedEvent, setCorrelation, playing, setPlaying, audioRef, playReplay }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-slate-900">Selected event</h2>{selectedEvent && <button onClick={() => { setSelectedEvent(null); setCorrelation({ events: [], beacons: [] }); }} className="text-xs text-slate-600 hover:text-slate-900">Clear</button>}</div>
    {!selectedEvent ? <p className="text-sm text-slate-500">Select an event to inspect its location, scores, and recording.</p> : <div><div className="grid grid-cols-2 gap-3 text-sm"><p><span className="block text-xs text-slate-500">Sound</span><strong>{selectedEvent.event.sound_class}</strong></p><p><span className="block text-xs text-slate-500">Beacon</span><strong>{selectedEvent.event.beacon_id}</strong></p><p><span className="block text-xs text-slate-500">Threat</span><strong className="text-warning">{Math.round(selectedEvent.event.threat_score * 100)}%</strong></p><p><span className="block text-xs text-slate-500">Fusion score</span><strong className="text-threat">{Math.round(selectedEvent.event.final_score * 100)}%</strong></p><p><span className="block text-xs text-slate-500">ACI</span><strong>{selectedEvent.event.aci_value.toFixed(3)}</strong></p><p><span className="block text-xs text-slate-500">Time</span><strong>{new Date(selectedEvent.event.timestamp).toLocaleString()}</strong></p></div>
      {selectedEvent.event.is_confirmed && <p className="mt-4 rounded-lg border border-moss-500/40 bg-moss-500/10 p-3 text-xs text-slate-600">Confirmed by multiple beacons / nearest guess: {correlation.correlation?.estimated_proximity_beacon_id || 'unknown'}</p>}
      {selectedEvent.event.audio_file_url ? <div className="mt-4"><Waveform playing={playing} /><audio ref={audioRef} controls className="mt-2 h-8 w-full" src={selectedEvent.event.audio_file_url.startsWith('http') ? selectedEvent.event.audio_file_url : `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}${selectedEvent.event.audio_file_url}`} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} /><button onClick={playReplay} className="mt-2 rounded-lg bg-moss-500 px-3 py-2 text-xs font-semibold text-white">Replay recording</button></div> : <p className="mt-4 rounded-lg bg-slate-100 p-3 text-xs text-slate-600">Audio was not saved for this event.</p>}
    </div>}
  </div>;
}

export default function DashboardPage() {
  const data = useDashboardData();
  const [selectedBeaconId, setSelectedBeaconId] = useState(null);
  const { beacons, events, summary, simulator, selectedZone, setSelectedZone, selectedEvent, setSelectedEvent, correlation, setCorrelation, aciBeacon, setAciBeacon, aciData, filterBeacon, setFilterBeacon, filterLevel, setFilterLevel, confirmedOnly, setConfirmedOnly, error, rippleBeacon, playing, setPlaying, audioRef, sidebarBeacons, assistantPrompt, setAssistantPrompt, assistantMessages, assistantBusy, highlightedBeacons, highlightedEvents, setHighlightedBeacons, setHighlightedEvents, askAssistant, selectEvent, playReplay, activeThreats } = data;
  const toggleBeacon = (beaconId) => setSelectedBeaconId((currentId) => currentId === beaconId ? null : beaconId);
  const handleAssistantBeaconSelect = (beaconId) => toggleBeacon(beaconId);
  const rightPanel = <AssistantPanel messages={assistantMessages} prompt={assistantPrompt} onPromptChange={setAssistantPrompt} onSubmit={askAssistant} busy={assistantBusy} highlighted={highlightedBeacons.length > 0 || highlightedEvents.length > 0} highlightedBeacons={highlightedBeacons} highlightedEvents={highlightedEvents} onBeaconSelect={handleAssistantBeaconSelect} onClear={() => { setHighlightedBeacons([]); setHighlightedEvents([]); setSelectedBeaconId(null); }} />;

  return <DashboardShell variant="dashboard" sidebarHealth={summary.forest_health_score} sidebarSummary={summary} sidebarBeacons={sidebarBeacons} selectedBeaconId={selectedBeaconId} onBeaconSelect={toggleBeacon} highlightedBeaconIds={highlightedBeacons} rightPanel={rightPanel}>
    <main className="dashboard-content mx-auto max-w-[1480px] px-4 py-6 sm:px-8 sm:py-10">
      <header className="dashboard-page-header mb-5 flex items-center justify-between gap-4"><div><p className="text-xs font-semibold tracking-[.18em] text-moss-400 mt-10">OVERVIEW</p><h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Forest health</h1><p className="mt-1 text-xs text-slate-500">Live score · last 5 minutes{summary.active_threat_penalty > 0 ? ` · ${summary.active_threat_penalty}% threat penalty` : ""}</p></div>
        <div className="dashboard-health-number text-6xl font-semibold tracking-[-.09em] text-slate-900 mt-10">{Math.round(summary.forest_health_score)}%</div>
      </header>
      {error && <div className="mb-4 rounded-xl border border-threat/50 bg-slate-100 px-4 py-3 text-sm text-slate-700">{error}</div>}
      <section><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Coverage map</h2><span className="text-xs text-slate-600">OpenStreetMap</span></div><BeaconMap beacons={beacons} simulator={simulator} selectedZone={selectedZone} setSelectedZone={setSelectedZone} selectedEvent={selectedEvent} relatedBeacons={correlation.beacons || []} rippleBeacon={rippleBeacon} highlightedBeacons={highlightedBeacons} selectedBeaconId={selectedBeaconId} onBeaconSelect={toggleBeacon} /><p className="mt-3 text-xs text-moss-400">Representative coordinates. The physical beacon is tested locally.</p></div></section>
      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"><AciChart data={aciData} /><EventActivity events={events} selectedEvent={selectedEvent} highlightedEvents={highlightedEvents} filterBeacon={filterBeacon} setFilterBeacon={setFilterBeacon} filterLevel={filterLevel} setFilterLevel={setFilterLevel} confirmedOnly={confirmedOnly} setConfirmedOnly={setConfirmedOnly} beacons={beacons} activeThreats={activeThreats} onSelect={selectEvent} /></section>
      <section className="mt-4"><SelectedEvent selectedEvent={selectedEvent} correlation={correlation} setSelectedEvent={setSelectedEvent} setCorrelation={setCorrelation} playing={playing} setPlaying={setPlaying} audioRef={audioRef} playReplay={playReplay} /></section>
    </main>
  </DashboardShell>;
}
