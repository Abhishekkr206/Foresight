import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { API, BOUNDS, THREAT_THRESHOLD } from '../config/constants';
import { endSession, getJson, getToken } from '../services/api';

const DashboardContext = createContext(null);

export function DashboardDataProvider({ children }) {
  return createElement(DashboardContext.Provider, { value: useSharedDashboardData() }, children);
}

export default function useDashboardData() {
  const data = useContext(DashboardContext);
  if (!data) throw new Error('DashboardDataProvider is required');
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const audio = audioRef.current;
    return () => { audio?.pause(); };
  }, [data.selectedEvent?.event?.id, data.selectedEvent?.event?.audio_file_url]);
  const playReplay = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
    audioRef.current.play().catch(() => {});
  };
  return { ...data, audioRef, playing, setPlaying, playReplay };
}

function useSharedDashboardData() {
  const { pathname } = useLocation();
  const dashboardActive = pathname === '/dashboard';
  const activeRef = useRef(dashboardActive);
  activeRef.current = dashboardActive;
  const [selectedBeaconId, setSelectedBeaconId] = useState(null);
  const [resourceErrors, setResourceErrors] = useState({});
  const [loaded, setLoaded] = useState({});
  const [queue, setQueue] = useState([]);
  const [beacons, setBeacons] = useState([]);
  const [allEvents, setAllEvents] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [summary, setSummary] = useState({ beacon_count: 0, active_beacon_count: 0, confirmed_events_today: 0, forest_health_score: null, aci_health_score: null, active_threat_count: 0, observed_zone_count: 0, populated_zone_count: 0, affected_zone_count: 0, total_zone_count: 16, zones: [] });
  const [simulator, setSimulator] = useState({ running: false, worker_healthy: false, zones: {} });
  const [selectedZone, setSelectedZone] = useState('zone_0_0');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [correlation, setCorrelation] = useState({ events: [], beacons: [] });
  const [aciBeacon, setAciBeacon] = useState('');
  const [aciData, setAciData] = useState([]);
  const [filterBeacon, setFilterBeacon] = useState('all');
  const [filterLevel, setFilterLevel] = useState('all');
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [sound, setSound] = useState('chainsaw');
  const [duration, setDuration] = useState(60);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [simulationNotice, setSimulationNotice] = useState(null);
  const [rippleBeacon, setRippleBeacon] = useState(null);
  const [assistantPrompt, setAssistantPrompt] = useState('');
  const [assistantMessages, setAssistantMessages] = useState([]);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState({ state: 'unverified' });
  const assistantRequest = useRef(null);
  const conversationVersion = useRef(0);
  const [highlightedBeacons, setHighlightedBeacons] = useState([]);
  const [highlightedEvents, setHighlightedEvents] = useState([]);
  const [assistantFilters, setAssistantFilters] = useState({});
  const refreshTimer = useRef(null);
  const refreshRef = useRef(() => {});
  const lifecycle = useRef(null);
  const aciBeaconRef = useRef(aciBeacon);
  aciBeaconRef.current = aciBeacon;
  const requests = useRef(new Map());
  const selectionRequest = useRef(null);
  const detectedScenarios = useRef(new Map());

  // Each resource owns its request: a slow summary never holds up the others.
  const loadResource = (name, path, apply, force = false) => {
    const existing = requests.current.get(name);
    if (existing && !force) { existing.queued = true; return existing.promise; }
    existing?.controller.abort();
    const controller = new AbortController();
    const request = { controller, queued: false };
    requests.current.set(name, request);
    request.promise = getJson(path, { signal: controller.signal }).then((value) => {
      if (controller.signal.aborted || requests.current.get(name) !== request) return;
      apply(value);
      setLoaded((current) => ({ ...current, [name]: true }));
      setResourceErrors((current) => ({ ...current, [name]: '' }));
    }).catch((failure) => {
      if (!controller.signal.aborted) {
        setResourceErrors((current) => ({ ...current, [name]: failure.message }));
      }
    }).finally(() => {
      if (requests.current.get(name) !== request) return;
      requests.current.delete(name);
      if (request.queued && lifecycle.current && !controller.signal.aborted && (activeRef.current || !['events', 'aci'].includes(name))) loadResource(name, path, apply);
    });
    return request.promise;
  };
  const refresh = (only) => {
    const force = typeof only === 'string';
    const want = (name) => typeof only !== 'string' || only === name;
    if (!lifecycle.current) return;
    if (want('beacons')) loadResource('beacons', '/api/beacons', (value) => {
      setBeacons(value);
      setAciBeacon((current) => current || value[0]?.beacon_id || '');
    }, force);
    if (want('status')) loadResource('status', '/api/status', setStatuses, force);
    if (want('summary')) loadResource('summary', '/api/summary', setSummary, force);
    if (want('simulation')) loadResource('simulation', '/api/simulation/status', (value) => setSimulator({ ...value, _receivedAt: Date.now() }), force);
    if (activeRef.current) {
      if (want('events')) loadResource('events', '/api/events?limit=500', setAllEvents, force);
      const beacon = aciBeaconRef.current;
      if (beacon && want('aci')) loadResource('aci', `/api/aci?beacon_id=${encodeURIComponent(beacon)}&limit=40`, setAciData, force);
    }
  };
  refreshRef.current = refresh;

  useEffect(() => {
    const token = {};
    lifecycle.current = token;
    let disposed = false;
    let socket;
    let reconnectTimer;
    let rippleTimer;
    let delay = 1000;
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(API.replace(/^http/, 'ws') + '/ws');
      socket.onopen = () => {
        if (disposed) return;
        const accessToken = getToken();
        if (accessToken) socket.send(accessToken);
      };
      socket.onclose = ({ code } = {}) => {
        if (disposed) return;
        setConnected(false);
        if (code === 4401) {
          endSession();
          return;
        }
        reconnectTimer = window.setTimeout(connect, delay);
        delay = Math.min(30000, delay * 2);
      };
      socket.onerror = () => socket.close();
      socket.onmessage = (message) => {
        if (disposed) return;
        try {
          const payload = JSON.parse(message.data);
          if (payload.type === 'auth.ready') {
            setConnected(true);
            delay = 1000;
            refreshRef.current();
            return;
          }
          if (payload.type === 'audio.ready') {
            window.dispatchEvent(new CustomEvent('foresight:audio-ready', { detail: payload.data }));
            return;
          }
          if (payload.type === 'simulation.status') {
            requests.current.get('simulation')?.controller.abort();
            requests.current.delete('simulation');
            setSimulator({ ...payload.data, _receivedAt: Date.now() });
            window.dispatchEvent(new CustomEvent('foresight:simulation-status', { detail: payload.data }));
            return;
          }
          if (payload.type === 'event.created') {
            setRippleBeacon(payload.data.beacon_id);
            window.clearTimeout(rippleTimer);
            rippleTimer = window.setTimeout(() => setRippleBeacon(null), 1800);
            if (payload.scenario_id) {
              const id = payload.scenario_id;
              const seen = detectedScenarios.current.get(id) || new Set();
              seen.add(payload.data.beacon_id); detectedScenarios.current.set(id, seen);
              if (detectedScenarios.current.size > 200) detectedScenarios.current.delete(detectedScenarios.current.keys().next().value);
              setSimulationNotice((current) => current?.scenarios?.some((item) => item.scenario_id === id && item.beacon_ids.includes(payload.data.beacon_id))
                ? { ...current, detected: [...new Set([...(current.detected || []), id])] } : current);
            }
          }
        } catch { return; }
        // Throttle rather than debounce: a continuous stream cannot starve refreshes.
        if (!refreshTimer.current) refreshTimer.current = window.setTimeout(() => {
          refreshTimer.current = null;
          refreshRef.current();
        }, 250);
      };
    };
    refreshRef.current();
    connect();
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') refreshRef.current();
    }, 15000);
    const onVisible = () => { if (document.visibilityState !== 'hidden') refreshRef.current(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      if (lifecycle.current === token) lifecycle.current = null;
      socket?.close();
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(rippleTimer);
      window.clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      for (const request of requests.current.values()) request.controller.abort();
      requests.current.clear();
      selectionRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (dashboardActive) refreshRef.current();
    else {
      selectionRequest.current?.abort();
      for (const name of ['events', 'aci']) {
        requests.current.get(name)?.controller.abort();
        requests.current.delete(name);
      }
    }
  }, [dashboardActive]);

  useEffect(() => {
    if (dashboardActive && aciBeacon) loadResource('aci', `/api/aci?beacon_id=${encodeURIComponent(aciBeacon)}&limit=40`, setAciData, true);
  }, [dashboardActive, aciBeacon]);

  const selectEvent = async (event) => {
    selectionRequest.current?.abort();
    const controller = new AbortController();
    selectionRequest.current = controller;
    setSelectedEvent({ event });
    setCorrelation({ events: [], beacons: [] });
    try {
      const [detail, related] = await Promise.all([
        getJson(`/api/events/${event.id}`, { signal: controller.signal }),
        getJson(`/api/events/${event.id}/correlation`, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      setSelectedEvent(detail);
      setCorrelation(related);
    } catch (requestError) {
      if (!controller.signal.aborted) setError(requestError.message);
    }
  };
  const callSimulation = async (path, options) => {
    setBusy(true);
    try {
      const result = await getJson(path, options);
      requests.current.get('simulation')?.controller.abort();
      requests.current.delete('simulation');
      setSimulator({ ...result, _receivedAt: Date.now() });
      setError('');

      return result;
    } catch (requestError) { setError(requestError.message); return null; }
    finally { setBusy(false); }
  };
  const start = () => callSimulation('/api/simulation/start', { method: 'POST' }).then((result) => result && setSimulationNotice({ kind: 'success', text: 'Simulation worker is running.' }));
  const stop = () => callSimulation('/api/simulation/stop', { method: 'POST' }).then((result) => result && setSimulationNotice({ kind: 'neutral', text: 'Simulation stopped.' }));
  const acceptedNotice = (scenarios) => ({
    kind: 'pending', text: 'Queued for processing', scenarios,
    detected: scenarios.filter((item) => item.beacon_ids.some((id) => detectedScenarios.current.get(item.scenario_id)?.has(id))).map((item) => item.scenario_id),
  });
  const trigger = async () => {
    setSimulationNotice({ kind: 'submitting', text: `Submitting ${sound} in ${selectedZone}...` });
    const result = await callSimulation('/api/simulation/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zone: selectedZone, sound, duration_seconds: Number(duration) }) });
    if (result?.accepted_scenario) setSimulationNotice(acceptedNotice([result.accepted_scenario]));
    else if (!result) setSimulationNotice({ kind: 'error', text: 'Trigger failed. Check the error above.' });
  };
  const triggerMany = async (items) => {
    if (!items.length) return null;
    setBusy(true);
    setSimulationNotice({ kind: 'submitting', text: `Submitting ${items.length} scenarios...` });
    const accepted = [];
    try {
      // Submit in queue order so repeated zones have predictable replacement behavior.
      for (const item of items) {
        const result = await getJson('/api/simulation/trigger', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zone: item.zone, sound: item.sound, duration_seconds: Number(item.duration) }) });
        accepted.push(result.accepted_scenario);
        requests.current.get('simulation')?.controller.abort(); requests.current.delete('simulation');
        setSimulator({ ...result, _receivedAt: Date.now() });
      }
      setSimulationNotice(acceptedNotice(accepted)); setError('');
      return accepted;
    } catch (failure) {
      setError(failure.message);
      setSimulationNotice({ kind: 'error', text: `${accepted.length} scenarios accepted; the remaining queue could not be submitted.`, scenarios: accepted });
      return null;
    } finally { setBusy(false); }
  };
  useEffect(() => {
    setSimulationNotice((current) => {
      if (!current?.scenarios?.length || current.kind === 'error') return current;
      const phases = current.scenarios.map((item) => {
        if (current.detected?.includes(item.scenario_id)) return 'detected';
        const zone = simulator.zones?.[item.zone];
        return zone?.scenario_id === item.scenario_id ? zone.phase : 'superseded';
      });
      const detected = phases.filter((phase) => phase === 'detected').length;
      const pending = phases.some((phase) => ['queued', 'processing'].includes(phase));
      const kind = phases.includes('failed') ? 'error' : pending ? 'pending' : detected === phases.length ? 'success' : 'neutral';
      const text = phases.length === 1
        ? ({ queued: 'Queued for processing', processing: 'Processing selected zone...', detected: 'Detected at an affected beacon', failed: 'Scenario processing failed', superseded: 'Scenario ended or was replaced' }[phases[0]] || 'Waiting for processing')
        : `${detected}/${phases.length} scenarios detected${pending ? ' - waiting for remaining scenarios' : ''}`;
      return current.text === text && current.kind === kind ? current : { ...current, text, kind };
    });
  }, [simulator, simulationNotice]);
  useEffect(() => {
    const controller = new AbortController();
    getJson('/api/assistant/status', { signal: controller.signal }).then(setAssistantStatus).catch(() => {});
    return () => { controller.abort(); assistantRequest.current?.abort(); };
  }, []);
  const newChat = () => {
    conversationVersion.current++;
    assistantRequest.current?.abort();
    setAssistantBusy(false); setAssistantMessages([]); setAssistantPrompt('');
    setAssistantFilters({}); setHighlightedBeacons([]); setHighlightedEvents([]);
  };
  const askAssistant = async (event) => {
    event.preventDefault();
    const prompt = assistantPrompt.trim();
    if (!prompt || assistantBusy) return;
    const controller = new AbortController();
    assistantRequest.current = controller;
    const version = conversationVersion.current;
    let budget = 12000;
    const history = [];
    for (const message of assistantMessages.filter((item) => !item.error).slice(-12).reverse()) {
      const text = message.text.slice(0, Math.min(2000, budget));
      if (!text) break;
      history.unshift({ role: message.role, text }); budget -= text.length;
    }
    setAssistantBusy(true); setAssistantMessages((items) => [...items, { role: 'user', text: prompt }]); setAssistantPrompt('');
    try {
      const result = await getJson('/api/assistant/query', { method: 'POST', signal: controller.signal, timeoutMs: 30000,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, history,
          selection: { zone_id: selectedZone || null, beacon_id: selectedBeaconId || null } }) });
      if (controller.signal.aborted || version !== conversationVersion.current) return;
      setAssistantStatus({ configured_model: result.model, mode: result.mode,
        state: result.used_llm ? 'connected' : result.fallback_reason === 'disabled' ? 'disabled' : 'unavailable', fallback_reason: result.fallback_reason });
      setAssistantMessages((items) => [...items, { role: 'assistant', text: result.answer,
        highlightedBeaconIds: result.highlight_beacon_ids || [], context: result.context || {} }]);
      const filters = result.filters || {};
      if (filters.beacon_id) setFilterBeacon(filters.beacon_id);
      if (filters.confirmed !== undefined) setConfirmedOnly(filters.confirmed);
      setAssistantFilters(filters); setHighlightedBeacons(result.highlight_beacon_ids || []); setHighlightedEvents(result.highlight_event_ids || []);
      if (result.selected_zone_id) setSelectedZone(result.selected_zone_id);
      if (result.selected_beacon_id) setAciBeacon(result.selected_beacon_id);
      if (result.selected_event_id) { const match = events.find((item) => item.id === result.selected_event_id); if (match) selectEvent(match); }
    } catch (failure) {
      if (!controller.signal.aborted && version === conversationVersion.current) setAssistantMessages((items) => [...items,
        { role: 'assistant', text: 'I could not reach the assistant. Please try again.', error: true }]);
    } finally {
      if (version === conversationVersion.current) setAssistantBusy(false);
    }
  };

  const events = useMemo(() => allEvents.filter((event) => {
    if (filterBeacon !== 'all' && event.beacon_id !== filterBeacon) return false;
    if (confirmedOnly && !event.is_confirmed) return false;
    if (filterLevel === 'normal' && event.final_score > THREAT_THRESHOLD) return false;
    if (filterLevel === 'threat' && event.final_score < THREAT_THRESHOLD) return false;
    if (filterLevel === 'high' && event.final_score < 0.75) return false;
    if (assistantFilters.threat_score_min !== undefined && event.threat_score < assistantFilters.threat_score_min) return false;
    if (assistantFilters.threat_score_max !== undefined && event.threat_score > assistantFilters.threat_score_max) return false;
    return true;
  }), [allEvents, filterBeacon, confirmedOnly, filterLevel, assistantFilters]);
  const statusById = Object.fromEntries(statuses.map((status) => [status.beacon_id, status]));
    const zoneFor = (beacon) => {
    const latStep = (BOUNDS.max_lat - BOUNDS.min_lat) / 4;
    const lonStep = (BOUNDS.max_lon - BOUNDS.min_lon) / 4;
    const row = Math.min(3, Math.max(0, Math.floor((beacon.latitude - BOUNDS.min_lat) / latStep)));
    const col = Math.min(3, Math.max(0, Math.floor((beacon.longitude - BOUNDS.min_lon) / lonStep)));
    return `zone_${row}_${col}`;
  };
  const sidebarBeacons = beacons.map((beacon) => {
    const latestEvent = allEvents.find((event) => event.beacon_id === beacon.beacon_id);
    const eventAge = latestEvent?.timestamp ? Date.now() - new Date(latestEvent.timestamp).getTime() : Number.POSITIVE_INFINITY;
    const scenarioThreat = Boolean(simulator?.zones?.[zoneFor(beacon)]?.threat);
    const eventThreat = Boolean(latestEvent && latestEvent.final_score >= THREAT_THRESHOLD && eventAge <= 60_000);
    const threatActive = scenarioThreat || eventThreat;
    const severity = threatActive ? 'threat' : latestEvent?.final_score >= 0.45 ? 'warning' : 'normal';
    return { ...beacon, active: statusById[beacon.beacon_id]?.active, battery_percentage: statusById[beacon.beacon_id]?.battery_percentage, severity, threat_active: threatActive };
  });
  return { initialLoading: !loaded.beacons && !resourceErrors.beacons, loaded, resourceErrors, selectedBeaconId, setSelectedBeaconId, queue, setQueue, beacons, events, summary, simulator, selectedZone, setSelectedZone, selectedEvent, setSelectedEvent, correlation, setCorrelation, aciBeacon, setAciBeacon, aciData, filterBeacon, setFilterBeacon, filterLevel, setFilterLevel, confirmedOnly, setConfirmedOnly, sound, setSound, duration, setDuration, connected, busy, error, simulationNotice, rippleBeacon, sidebarBeacons, assistantPrompt, setAssistantPrompt, assistantMessages, assistantBusy, assistantStatus, newChat, highlightedBeacons, highlightedEvents, setHighlightedBeacons, setHighlightedEvents, askAssistant, selectEvent, refresh, start, stop, trigger, triggerMany, activeThreats: summary.active_threat_count > 0 };
}
