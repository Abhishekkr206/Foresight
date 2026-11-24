import { ArrowsClockwise, CaretDown } from '@phosphor-icons/react';

import { useEffect, useRef, useState } from 'react';
import AciChart from '../components/AciChart';
import BeaconMap from '../components/BeaconMap';
import Waveform from '../components/Waveform';
import useDashboardData from '../hooks/useDashboardData';
import { BOUNDS, THREAT_THRESHOLD } from '../config/constants';
import { getBlob } from '../services/api';

function EventActivity({ loading, events, selectedEvent, highlightedEvents, newEventIds, filterBeacon, setFilterBeacon, filterLevel, setFilterLevel, confirmedOnly, setConfirmedOnly, beacons, activeThreats, onSelect }) {
  return <div className="event-activity-panel min-h-[430px] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl transition-[min-height] duration-300">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Event activity</h2><div className="flex flex-wrap gap-2">
      <label className="relative"><span className="sr-only">Filter by beacon</span><select value={filterBeacon} onChange={(event) => setFilterBeacon(event.target.value)} className="appearance-none rounded-xl border border-slate-300 bg-slate-50 py-2 pl-3 pr-8 text-xs font-medium text-slate-800 outline-none transition hover:border-slate-400 focus:border-moss-500 focus:ring-2 focus:ring-moss-500/20"><option value="all">All beacons</option>{beacons.map((beacon) => <option key={beacon.beacon_id} value={beacon.beacon_id}>{beacon.beacon_id}</option>)}</select><CaretDown weight="duotone" size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" /></label>
      <label className="relative"><span className="sr-only">Filter by severity</span><select value={filterLevel} onChange={(event) => setFilterLevel(event.target.value)} className="appearance-none rounded-xl border border-slate-300 bg-slate-50 py-2 pl-3 pr-8 text-xs font-medium text-slate-800 outline-none transition hover:border-slate-400 focus:border-moss-500 focus:ring-2 focus:ring-moss-500/20"><option value="all">All severity</option><option value="normal">Normal</option><option value="threat">Threat</option><option value="high">High</option></select><CaretDown weight="duotone" size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500" /></label>
      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-400"><input className="h-3.5 w-3.5 accent-[#588157]" type="checkbox" checked={confirmedOnly} onChange={(event) => setConfirmedOnly(event.target.checked)} /> Confirmed only</label>
    </div></div>
    {loading ? <p role="status" className="p-6 text-sm text-slate-500">Loading events…</p> : events.length === 0 ? <div className="rounded-xl bg-slate-100 p-6 text-sm text-slate-600">{activeThreats ? 'No matching events.' : 'All clear, no acoustic threats detected'}</div> : <div className="max-h-[360px] min-h-[360px] overflow-auto transition-[opacity] duration-200">{events.map((event) => <button key={event.id} onClick={() => onSelect(event)} className={`${newEventIds.includes(event.id) ? 'event-row-enter' : ''} flex w-full flex-wrap items-center gap-3 border-t border-slate-200 py-3 text-left transition hover:bg-slate-50 ${selectedEvent?.event?.id === event.id ? 'bg-slate-100' : highlightedEvents.includes(event.id) ? 'bg-moss-500/10' : ''}`}><span className={`h-2.5 w-2.5 rounded-full ${event.final_score >= 0.75 ? 'bg-threat' : event.final_score >= 0.45 ? 'bg-warning' : 'bg-moss-500'}`}></span><span className="min-w-[120px] flex-1"><span className="block text-sm font-medium text-slate-900">{event.sound_class}</span><span className="mt-1 block text-xs text-slate-600">{event.beacon_id} / {new Date(event.timestamp).toLocaleTimeString()}</span></span><span className="text-sm font-semibold text-warning">{Math.round(event.final_score * 100)}%</span>{event.is_confirmed && <span className="rounded-full border border-moss-500/50 px-2 py-1 text-[10px] text-moss-500">Confirmed</span>}</button>)}</div>}
  </div>;
}

function SelectedEvent({ selectedEvent, correlation, setSelectedEvent, setCorrelation, playing, setPlaying, audioRef, playReplay }) {
  const recording = selectedEvent?.event.audio_file_url;
  const localRecording = recording?.startsWith('/uploads/') ? recording : null;
  const [loadedAudio, setLoadedAudio] = useState(null);

  useEffect(() => {
    if (!localRecording) return;
    const controller = new AbortController();
    let url;
    getBlob(localRecording, { signal: controller.signal, cache: 'no-store' }).then((blob) => {
      if (controller.signal.aborted) return;
      url = URL.createObjectURL(blob);
      setLoadedAudio({ recording: localRecording, url });
    }).catch(() => {
      if (!controller.signal.aborted) setLoadedAudio({ recording: localRecording, error: true });
    });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
      setLoadedAudio(null);
    };
  }, [localRecording]);

  const localAudio = loadedAudio?.recording === localRecording ? loadedAudio : null;
  const source = localRecording ? localAudio?.url : recording;
  return <div className="event-activity-panel min-h-[430px] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl transition-[min-height] duration-300"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold text-slate-900">Selected event</h2>{selectedEvent && <button onClick={() => { setSelectedEvent(null); setCorrelation({ events: [], beacons: [] }); }} className="text-xs text-slate-600 hover:text-slate-900">Clear</button>}</div>
    {!selectedEvent ? <p className="text-sm text-slate-500">Select an event to inspect its location, scores, and recording.</p> : <div><div className="grid grid-cols-2 gap-3 text-sm"><p><span className="block text-xs text-slate-500">Sound</span><strong>{selectedEvent.event.sound_class}</strong></p><p><span className="block text-xs text-slate-500">Beacon</span><strong>{selectedEvent.event.beacon_id}</strong></p><p><span className="block text-xs text-slate-500">Threat</span><strong className="text-warning">{Math.round(selectedEvent.event.threat_score * 100)}%</strong></p><p><span className="block text-xs text-slate-500">Fusion score</span><strong className="text-threat">{Math.round(selectedEvent.event.final_score * 100)}%</strong></p><p><span className="block text-xs text-slate-500">ACI</span><strong>{selectedEvent.event.aci_value.toFixed(3)}</strong></p><p><span className="block text-xs text-slate-500">Time</span><strong>{new Date(selectedEvent.event.timestamp).toLocaleString()}</strong></p></div>
      {selectedEvent.event.is_confirmed && <p className="mt-4 rounded-lg border border-moss-500/40 bg-moss-500/10 p-3 text-xs text-slate-600">Confirmed by multiple beacons / nearest guess: {correlation.correlation?.estimated_proximity_beacon_id || 'unknown'}</p>}
      {source ? <div className="mt-4"><Waveform playing={playing} /><audio ref={audioRef} controls className="mt-2 h-8 w-full" src={source} onPlay={() => { window.dispatchEvent(new Event('foresight:pause-live-audio')); setPlaying(true); }} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} /><button onClick={playReplay} className="mt-2 rounded-lg bg-moss-500 px-3 py-2 text-xs font-semibold text-white">Replay recording</button></div> : <p className="mt-4 rounded-lg bg-slate-100 p-3 text-xs text-slate-600">{localAudio?.error ? 'Recording unavailable.' : recording ? 'Loading recording…' : 'Audio was not saved for this event.'}</p>}
    </div>}
  </div>;
}

export default function DashboardPage({ active = true }) {
  const data = useDashboardData();
  const { selectedBeaconId, setSelectedBeaconId } = data;
  useEffect(() => {
    if (!active) {
      data.audioRef.current?.pause();
      data.setPlaying(false);
    }
  }, [active]);
  const [newEventIds, setNewEventIds] = useState([]);
  const knownEventIds = useRef(new Set());

  const { beacons, events, summary, simulator, selectedZone, setSelectedZone, selectedEvent, setSelectedEvent, correlation, setCorrelation, aciBeacon, setAciBeacon, aciData, filterBeacon, setFilterBeacon, filterLevel, setFilterLevel, confirmedOnly, setConfirmedOnly, error, initialLoading, loaded, resourceErrors, rippleBeacon, playing, setPlaying, audioRef, sidebarBeacons, assistantPrompt, setAssistantPrompt, assistantMessages, assistantBusy, highlightedBeacons, highlightedEvents, setHighlightedBeacons, setHighlightedEvents, askAssistant, selectEvent, refresh, playReplay, activeThreats } = data;
  useEffect(() => {
    const incoming = events.filter((event) => !knownEventIds.current.has(event.id)).map((event) => event.id);
    if (knownEventIds.current.size > 0 && incoming.length) {
      setNewEventIds(incoming);
      const timer = window.setTimeout(() => setNewEventIds([]), 1100);
      knownEventIds.current = new Set(events.map((event) => event.id));
      return () => window.clearTimeout(timer);
    }
    knownEventIds.current = new Set(events.map((event) => event.id));
    return undefined;
  }, [events]);
  useEffect(() => {
    const pauseReplay = () => {
      audioRef.current?.pause();
      setPlaying(false);
    };
    window.addEventListener('foresight:pause-event-audio', pauseReplay);
    return () => window.removeEventListener('foresight:pause-event-audio', pauseReplay);
  }, []);
  const toggleBeacon = (beaconId) => setSelectedBeaconId((currentId) => currentId === beaconId ? null : beaconId);
  const zoneFor = (beacon) => { const latStep = (BOUNDS.max_lat - BOUNDS.min_lat) / 4; const lonStep = (BOUNDS.max_lon - BOUNDS.min_lon) / 4; const row = Math.min(3, Math.max(0, Math.floor((beacon.latitude - BOUNDS.min_lat) / latStep))); const col = Math.min(3, Math.max(0, Math.floor((beacon.longitude - BOUNDS.min_lon) / lonStep))); return `zone_${row}_${col}`; };
  const handleEventSelect = async (event) => { await selectEvent(event); const selected = beacons.find((beacon) => beacon.beacon_id === event.beacon_id); const eventIsThreat = event.final_score >= THREAT_THRESHOLD; setSelectedBeaconId(event.beacon_id); setHighlightedBeacons(eventIsThreat && selected ? beacons.filter((beacon) => zoneFor(beacon) === zoneFor(selected)).map((beacon) => beacon.beacon_id) : [event.beacon_id]); };
  return (
    <main className="dashboard-content mx-auto max-w-[1480px] px-4 py-6 sm:px-8 sm:py-10">
      {error && <div className="mb-4 rounded-xl border border-threat/50 bg-slate-100 px-4 py-3 text-sm text-slate-700">{error}</div>}
      <section className="dashboard-intro-item dashboard-intro-item-2"><div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl sm:p-5"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Coverage map</h2><div className="flex items-center gap-3"><span className="text-xs text-slate-600">OpenStreetMap</span><button type="button" onClick={refresh} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"><ArrowsClockwise weight="duotone" size={14} /> Refresh</button></div></div>{initialLoading ? <div className="flex h-[530px] items-center justify-center rounded-xl bg-slate-100"><div className="text-center"><div className="mx-auto h-2 w-40 animate-pulse rounded-full bg-slate-300" /><p className="mt-3 text-xs text-slate-500">Loading forest signal</p></div></div> : <BeaconMap active={active} beacons={beacons} simulator={simulator} selectedZone={selectedZone} setSelectedZone={setSelectedZone} selectedEvent={selectedEvent} relatedBeacons={correlation.beacons || []} rippleBeacon={rippleBeacon} highlightedBeacons={highlightedBeacons} selectedBeaconId={selectedBeaconId} onBeaconSelect={toggleBeacon} />}</div></section>
      <section className="dashboard-intro-item dashboard-intro-item-3 mt-4 grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1.55fr)]"><EventActivity loading={!loaded.events && !resourceErrors.events} events={events} selectedEvent={selectedEvent} highlightedEvents={highlightedEvents} newEventIds={newEventIds} filterBeacon={filterBeacon} setFilterBeacon={setFilterBeacon} filterLevel={filterLevel} setFilterLevel={setFilterLevel} confirmedOnly={confirmedOnly} setConfirmedOnly={setConfirmedOnly} beacons={beacons} activeThreats={activeThreats} onSelect={handleEventSelect} />{!loaded.aci && !resourceErrors.aci ? <p role="status" className="rounded-2xl bg-white p-6 text-sm text-slate-500">Loading acoustic history…</p> : <AciChart data={aciData} beaconId={aciBeacon} />}</section>
      <section className={`dashboard-intro-item dashboard-intro-item-4 mt-4 ${selectedEvent ? 'selected-event-open' : ''}`}><SelectedEvent selectedEvent={selectedEvent} correlation={correlation} setSelectedEvent={setSelectedEvent} setCorrelation={setCorrelation} playing={playing} setPlaying={setPlaying} audioRef={audioRef} playReplay={playReplay} /></section>
    </main>
  );
}


