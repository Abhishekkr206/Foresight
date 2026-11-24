import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { getBlob, getJson } from '../services/api';
import useDashboardData from './useDashboardData';

const Context = createContext(null);
export const useLiveAudio = () => useContext(Context);

export function LiveAudioProvider({ children }) {
  const { selectedBeaconId, setSelectedBeaconId, simulator } = useDashboardData();
  const audioRef = useRef(null);
  const intent = useRef(true);
  const simulationRef = useRef(simulator);
  const session = useRef(null);
  const [status, setStatus] = useState('waiting');
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    simulationRef.current = simulator;
    session.current?.checkExpiry();
  }, [simulator]);

  useEffect(() => {
    const audio = audioRef.current;
    const state = { disposed: false, fetching: false, queued: false, controller: null,
      current: null, pending: null, expiryTimer: null, generation: 0 };
    session.current = state;
    intent.current = true;
    setMeta(null); setError(''); setStatus(selectedBeaconId ? 'loading' : 'waiting');
    audio.pause(); audio.removeAttribute('src'); audio.load();
    const revoke = (item) => { if (item?.url) URL.revokeObjectURL(item.url); };
    const isValid = (capture) => {
      if (!capture.is_simulated) return true;
      const snapshot = simulationRef.current;
      if (snapshot.running === false) return false;
      if (capture.expires_at && Date.parse(capture.expires_at) <= Date.now()) return false;
      const active = snapshot.zones?.[capture.zone];
      return !active || (active.scenario_id || null) === (capture.scenario_id || null);
    };
    const playbackKey = (capture) => capture.is_simulated
      ? `${capture.beacon_id}:${capture.scenario_id || 'ambient'}` : capture.capture_id;
    const startItem = (item) => {
      if (state.disposed || !isValid(item.meta)) { revoke(item); return; }
      clearTimeout(state.expiryTimer);
      const old = state.current;
      state.current = item;
      audio.pause(); audio.src = item.url;
      audio.loop = Boolean(item.meta.is_simulated);
      audio.load(); revoke(old);
      setMeta(item.meta); setError('');
      state.checkExpiry();
      if (state.current !== item) return;
      if (intent.current) {
        window.dispatchEvent(new Event('foresight:pause-event-audio'));
        audio.play().then(() => { if (!state.disposed && intent.current && !audio.paused) setStatus('playing'); }).catch(() => {
          if (!state.disposed) setStatus('ready');
        });
      } else setStatus('paused');
    };
    state.checkExpiry = () => {
      clearTimeout(state.expiryTimer);
      const current = state.current;
      if (!current?.meta.is_simulated) return;
      // A new queued scenario may leave the old clip playing until its capture arrives.
      const expired = current.meta.expires_at && Date.parse(current.meta.expires_at) <= Date.now();
      const snapshot = simulationRef.current;
      const zone = snapshot.zones?.[current.meta.zone];
      if (expired || snapshot.running === false || (current.meta.scenario_id && zone && !zone.scenario_id)) {
        audio.pause(); audio.loop = false;
        state.current = null; revoke(current);
        setStatus(intent.current ? 'waiting' : 'paused');
        return;
      }
      if (current.meta.expires_at) state.expiryTimer = setTimeout(state.checkExpiry,
        Math.max(1, Date.parse(current.meta.expires_at) - Date.now()));
    };
    const load = async (hint) => {
      if (!selectedBeaconId || state.disposed || !intent.current) return;
      if (state.fetching) { state.queued = true; return; }
      state.fetching = true;
      const controller = new AbortController(); state.controller = controller;
      const generation = state.generation;
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const capture = hint || await getJson(`/api/debug/audio/latest/meta?beacon_id=${encodeURIComponent(selectedBeaconId)}`, { signal: controller.signal });
        if (state.disposed || generation !== state.generation || !isValid(capture)) return;
        if (state.current && playbackKey(state.current.meta) === playbackKey(capture)) {
          state.current.meta = { ...state.current.meta, ...capture };
          setMeta(state.current.meta); state.checkExpiry(); return;
        }
        if (state.pending?.meta.capture_id === capture.capture_id) return;
        const blob = await getBlob(`/api/debug/audio/latest?beacon_id=${encodeURIComponent(selectedBeaconId)}&capture_id=${encodeURIComponent(capture.capture_id)}`, { signal: controller.signal, cache: 'no-store' });
        if (state.disposed || generation !== state.generation || !isValid(capture)) return;
        const item = { meta: capture, url: URL.createObjectURL(blob) };
        if (!capture.is_simulated && state.current && !audio.paused && !audio.ended) {
          revoke(state.pending); state.pending = item;
        } else startItem(item);
      } catch (failure) {
        if (!intent.current || generation !== state.generation) return;
        if (!state.disposed && failure.status === 409) {
          state.queued = true;
        } else if (!state.disposed && failure.status === 404) {
          setError(''); setStatus('waiting');
        } else if (!state.disposed && !controller.signal.aborted) {
          setError(failure.message); setStatus('error');
        } else if (!state.disposed && intent.current) {
          setError('Audio request timed out. Press Play to retry.'); setStatus('error');
        }
      } finally {
        clearTimeout(timeout); state.fetching = false;
        if (state.queued && !state.disposed) { state.queued = false; load(); }
      }
    };
    state.load = load;
    state.pause = (stop = false) => {
      intent.current = false; state.generation++;
      state.controller?.abort();
      audio.pause(); if (stop) audio.currentTime = 0;
      revoke(state.pending); state.pending = null;
      setStatus('paused');
    };
    state.play = () => {
      intent.current = true; setError('');
      if (state.current && isValid(state.current.meta)) {
        window.dispatchEvent(new Event('foresight:pause-event-audio'));
        audio.play().then(() => {
          if (!state.disposed && intent.current && !audio.paused) setStatus('playing');
        }).catch(() => { if (!state.disposed) setStatus('ready'); });
      }
      load();
    };
    const onReady = (event) => { if (event.detail.beacon_id === selectedBeaconId) load(event.detail); };
    const onSimulation = (event) => { simulationRef.current = event.detail; state.checkExpiry(); };
    const onPause = () => state.pause();
    const onEnded = () => {
      if (state.pending && intent.current) {
        const next = state.pending; state.pending = null; startItem(next);
      } else if (intent.current) { setStatus('waiting'); load(); }
    };
    audio.addEventListener('ended', onEnded);
    window.addEventListener('foresight:audio-ready', onReady);
    window.addEventListener('foresight:simulation-status', onSimulation);
    window.addEventListener('foresight:pause-live-audio', onPause);
    load();
    const poll = setInterval(() => load(), 3000);
    return () => {
      state.disposed = true; state.controller?.abort(); audio.pause();
      clearInterval(poll); clearTimeout(state.expiryTimer);
      revoke(state.current); revoke(state.pending);
      audio.removeEventListener('ended', onEnded);
      window.removeEventListener('foresight:audio-ready', onReady);
      window.removeEventListener('foresight:simulation-status', onSimulation);
      window.removeEventListener('foresight:pause-live-audio', onPause);
    };
  }, [selectedBeaconId]);

  const play = () => session.current?.play();
  const pause = () => session.current?.pause();
  const stop = () => session.current?.pause(true);
  const listenTo = (id) => {
    if (id === selectedBeaconId) play();
    else setSelectedBeaconId(id);
  };
  return <Context.Provider value={{ status, meta, error, play, pause, stop, listenTo, selectedBeaconId }}>
    {children}<audio ref={audioRef} data-testid="live-audio" preload="auto" hidden />
  </Context.Provider>;
}
