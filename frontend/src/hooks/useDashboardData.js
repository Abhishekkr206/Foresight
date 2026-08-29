import { useEffect, useRef, useState } from 'react';
import { API, THREAT_THRESHOLD } from '../config/constants';
import { getJson } from '../services/api';

export default function useDashboardData() {
  const [beacons, setBeacons] = useState([]);
  const [allEvents, setAllEvents] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [summary, setSummary] = useState({ beacon_count: 0, active_beacon_count: 0, confirmed_events_today: 0, forest_health_score: 100, active_threat_count: 0 });
  const [simulator, setSimulator] = useState({ running: false, worker_healthy: false, zones: {} });
  const [selectedZone, setSelectedZone] = useState('zone_1_1');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [correlation, setCorrelation] = useState({ events: [], beacons: [] });
  const [aciBeacon, setAciBeacon] = useState('');
  const [aciData, setAciData] = useState([]);
  const [filterBeacon, setFilterBeacon] = useState('all');
  const [filterLevel, setFilterLevel] = useState('all');
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [sound, setSound] = useState('chainsaw');
  const [duration, setDuration] = useState(30);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [simulationNotice, setSimulationNotice] = useState(null);
  const [rippleBeacon, setRippleBeacon] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [highlightedBeacons, setHighlightedBeacons] = useState([]);
  const [highlightedEvents, setHighlightedEvents] = useState([]);
  const [assistantFilters, setAssistantFilters] = useState({});
  const audioRef = useRef(null);
  const refreshSequence = useRef(0);
  const refreshTimer = useRef(null);

  const refresh = async () => {
    const requestId = ++refreshSequence.current;
    try {
      const params = new URLSearchParams({ limit: '500' });
      const [beaconData, eventData, statusData, summaryData, simulationData] = await Promise.all([
        getJson('/api/beacons'), getJson(`/api/events?${params}`), getJson('/api/status'), getJson('/api/summary'), getJson('/api/simulation/status'),
      ]);
      if (requestId !== refreshSequence.current) return;
      setBeacons(beaconData); setAllEvents(eventData); setStatuses(statusData); setSummary(summaryData); setSimulator({ ...simulationData, _receivedAt: Date.now() });
      if (!aciBeacon && beaconData.length) setAciBeacon(beaconData[0].beacon_id);
      setError('');
    } catch (requestError) { setError(requestError.message); }
  };

  useEffect(() => {
    refresh();
    const socket = new WebSocket(API.replace(/^http/, 'ws') + '/ws');
    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (message) => {
      try {
        const payload = JSON.parse(message.data);
        if (payload.type === 'event.created') {
          const id = payload.data.beacon_id;
          setRippleBeacon(id);
          setTimeout(() => setRippleBeacon(null), 1800);
          setSimulationNotice((current) => current?.kind === 'pending'
            ? { kind: 'success', text: `Audio processed — event detected at ${id}.` }
            : current);
        }
      } catch {}
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(refresh, 250);
    };
    return () => { socket.close(); window.clearTimeout(refreshTimer.current); };
  }, []);

  useEffect(() => { if (aciBeacon) getJson(`/api/aci?beacon_id=${encodeURIComponent(aciBeacon)}&limit=40`).then(setAciData).catch(() => {}); }, [aciBeacon, allEvents.length]);

  const selectEvent = async (event) => { setSelectedEvent({ event }); try { const [detail, related] = await Promise.all([getJson(`/api/events/${event.id}`), getJson(`/api/events/${event.id}/correlation`)]); setSelectedEvent(detail); setCorrelation(related); } catch (requestError) { setError(requestError.message); } };
  const callSimulation = async (path, options) => {
    setBusy(true);
    try {
      const result = await getJson(path, options);
      setSimulator({ ...result, _receivedAt: Date.now() });
      setError('');
      return result;
    } catch (requestError) { setError(requestError.message); return null; }
    finally { setBusy(false); }
  };
  const start = () => callSimulation('/api/simulation/start', { method: 'POST' }).then((result) => result && setSimulationNotice({ kind: 'success', text: 'Simulation worker is running.' }));
  const stop = () => callSimulation('/api/simulation/stop', { method: 'POST' }).then((result) => result && setSimulationNotice({ kind: 'neutral', text: 'Simulation stopped.' }));
  const trigger = async () => {
    setSimulationNotice({ kind: 'pending', text: `Trigger accepted — processing ${sound} in ${selectedZone}…` });
    const result = await callSimulation('/api/simulation/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zone: selectedZone, sound, duration_seconds: Number(duration) }) });
    if (!result) setSimulationNotice({ kind: 'error', text: 'Trigger failed. Check the error above.' });
    window.setTimeout(refresh, 1200);
  };
  const triggerMany = async (items) => {
    if (!items.length) return null;
    setBusy(true);
    setSimulationNotice({ kind: 'pending', text: 'Triggering ' + items.length + ' queued scenario' + (items.length === 1 ? '' : 's') + '…' });
    try {
      const results = await Promise.all(items.map((item) => getJson('/api/simulation/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone: item.zone, sound: item.sound, duration_seconds: Number(item.duration) }),
      })));
      const latest = results[results.length - 1];
      setSimulator({ ...latest, _receivedAt: Date.now() });
      setSimulationNotice({ kind: 'success', text: items.length + ' scenario' + (items.length === 1 ? '' : 's') + ' accepted and running.' });
      setError('');
      window.setTimeout(refresh, 1200);
      return results;
    } catch (requestError) {
      setError(requestError.message);
      setSimulationNotice({ kind: 'error', text: 'One or more queued triggers failed.' });
      return null;
    } finally { setBusy(false); }
  };
  const playReplay = () => { if (!audioRef.current) return; audioRef.current.currentTime = 0; audioRef.current.play().catch(() => setError('Audio could not be played.')); };
  const askAssistant = async (event) => {
    event.preventDefault();
    const prompt = assistantPrompt.trim();
    if (!prompt || assistantBusy) return;
    setAssistantBusy(true); setAssistantMessages((items) => [...items, { role: 'user', text: prompt }]); setAssistantPrompt('');
    try {
      const result = await getJson('/api/assistant/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
      setAssistantMessages((items) => [...items, { role: 'assistant', text: result.answer, fallback: !result.used_llm, highlightedBeaconIds: result.highlight_beacon_ids || [], highlightedEventCount: (result.highlight_event_ids || []).length, selectedBeaconId: result.selected_beacon_id || null }]);
      const filters = result.filters || {};
      if (filters.beacon_id) setFilterBeacon(filters.beacon_id);
      if (filters.confirmed !== undefined) setConfirmedOnly(filters.confirmed);
      setAssistantFilters(filters); setHighlightedBeacons(result.highlight_beacon_ids || []); setHighlightedEvents(result.highlight_event_ids || []);
      if (result.selected_beacon_id) setAciBeacon(result.selected_beacon_id);
      if (result.selected_event_id) { const match = events.find((item) => item.id === result.selected_event_id); if (match) selectEvent(match); }
    } catch { setAssistantMessages((items) => [...items, { role: 'assistant', text: 'Assistant unavailable. Try a simpler dashboard question.', error: true }]); }
    finally { setAssistantBusy(false); }
  };

  const events = allEvents.filter((event) => {
    if (filterBeacon !== 'all' && event.beacon_id !== filterBeacon) return false;
    if (confirmedOnly && !event.is_confirmed) return false;
    if (filterLevel === 'normal' && event.final_score > THREAT_THRESHOLD) return false;
    if (filterLevel === 'threat' && event.final_score < THREAT_THRESHOLD) return false;
    if (filterLevel === 'high' && event.final_score < 0.75) return false;
    if (assistantFilters.threat_score_min !== undefined && event.threat_score < assistantFilters.threat_score_min) return false;
    if (assistantFilters.threat_score_max !== undefined && event.threat_score > assistantFilters.threat_score_max) return false;
    return true;
  });
  const statusById = Object.fromEntries(statuses.map((status) => [status.beacon_id, status]));
  const sidebarBeacons = beacons.map((beacon) => ({ ...beacon, active: statusById[beacon.beacon_id]?.active, battery_percentage: statusById[beacon.beacon_id]?.battery_percentage }));
  return { beacons, events, summary, simulator, selectedZone, setSelectedZone, selectedEvent, setSelectedEvent, correlation, setCorrelation, aciBeacon, setAciBeacon, aciData, filterBeacon, setFilterBeacon, filterLevel, setFilterLevel, confirmedOnly, setConfirmedOnly, sound, setSound, duration, setDuration, connected, busy, error, simulationNotice, rippleBeacon, playing, setPlaying, audioRef, sidebarBeacons, assistantPrompt, setAssistantPrompt, assistantMessages, assistantBusy, highlightedBeacons, highlightedEvents, setHighlightedBeacons, setHighlightedEvents, askAssistant, selectEvent, refresh, start, stop, trigger, triggerMany, playReplay, activeThreats: summary.active_threat_count > 0 };
}
