import { LoaderCircle, Pause, Play, Radio, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { API } from '../config/constants';
import Waveform from './Waveform';

export default function BeaconAudioPlayer({ beaconId }) {
  const audioRef = useRef(null);
  const objectUrlRef = useRef(null);
  const latestReceivedRef = useRef(null);
  const requestRef = useRef(0);
  const listeningRef = useRef(true);
  const [audioUrl, setAudioUrl] = useState('');
  const [status, setStatus] = useState('loading');
  const [receivedAt, setReceivedAt] = useState(null);
  const [listening, setListening] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestRef.current;
    latestReceivedRef.current = null;
    setAudioUrl('');
    setReceivedAt(null);
    setError('');
    setStatus('loading');
    setListening(true);
    listeningRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;

    const loadLatest = async (shouldPlay = false) => {
      if (!beaconId || cancelled || (!shouldPlay && !listeningRef.current)) return;
      try {
        const metaResponse = await fetch(`${API}/api/debug/audio/latest/meta?beacon_id=${encodeURIComponent(beaconId)}`);
        if (metaResponse.status === 404) {
          if (!cancelled) setStatus('waiting');
          return;
        }
        if (!metaResponse.ok) throw new Error('Audio status unavailable');
        const meta = await metaResponse.json();
        if (cancelled || requestId !== requestRef.current || meta.received_at === latestReceivedRef.current) return;
        const audioResponse = await fetch(`${API}/api/debug/audio/latest?beacon_id=${encodeURIComponent(beaconId)}&received_at=${encodeURIComponent(meta.received_at)}`);
        if (!audioResponse.ok) throw new Error('Audio capture unavailable');
        const blob = await audioResponse.blob();
        if (cancelled || requestId !== requestRef.current) return;
        const nextUrl = URL.createObjectURL(blob);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = nextUrl;
        latestReceivedRef.current = meta.received_at;
        setAudioUrl(nextUrl);
        setReceivedAt(meta.received_at);
        setStatus('paused');
        setError('');
        window.setTimeout(() => {
          if (!shouldPlay && !listeningRef.current) return;
          if (!audioRef.current || requestId !== requestRef.current) return;
          audioRef.current.src = nextUrl;
          audioRef.current.load();
          audioRef.current.play().then(() => setStatus('playing')).catch(() => setStatus('paused'));
        }, 0);
      } catch (requestError) {
        if (!cancelled) {
          setStatus('error');
          setError(requestError.message);
        }
      }
    };

    loadLatest(true);
    const refreshTimer = window.setInterval(() => loadLatest(false), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
    };
  }, [beaconId]);

  const togglePlayback = () => {
    if (!audioRef.current || !audioUrl) return;
    if (audioRef.current.paused) {
      setListening(true);
      listeningRef.current = true;
      audioRef.current.play().then(() => setStatus('playing')).catch(() => setStatus('paused'));
    } else {
      setListening(false);
            listeningRef.current = false;
      audioRef.current.pause();
      setStatus('paused');
    }
  };

  const stopPlayback = () => {
    if (!audioRef.current) return;
    setListening(false);
          listeningRef.current = false;
      audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setStatus(audioUrl ? 'paused' : 'waiting');
  };

  if (!beaconId) return null;
  const statusLabel = status === 'loading' ? 'Loading capture…' : status === 'waiting' ? 'Waiting for first capture' : status === 'error' ? error : status === 'playing' ? 'Listening live' : 'Capture ready';

  return <div className="beacon-audio-player mt-4 rounded-2xl border border-moss-500/25 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[.14em] text-moss-500"><Radio size={12} /> LISTENING</p><p className="mt-1 truncate text-sm font-semibold text-slate-900">{beaconId}</p><p className="mt-1 text-[10px] text-slate-500">{statusLabel}</p></div>
      {status === 'loading' && <LoaderCircle size={16} className="animate-spin text-moss-500" />}
    </div>
    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2"><Waveform playing={status === 'playing'} /><audio ref={audioRef} src={audioUrl || undefined} preload="auto" className="mt-2 h-8 w-full" onPlay={() => setStatus('playing')} onPause={() => { if (status === 'playing') setStatus('paused'); }} onEnded={() => setStatus('paused')} /></div>
    <div className="mt-3 flex items-center gap-2"><button type="button" onClick={togglePlayback} disabled={!audioUrl} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-moss-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-moss-400 disabled:cursor-not-allowed disabled:opacity-40">{status === 'playing' ? <Pause size={13} /> : <Play size={13} />}{status === 'playing' ? 'Pause' : 'Play capture'}</button><button type="button" onClick={stopPlayback} disabled={!audioUrl} aria-label="Stop listening" className="inline-flex items-center justify-center rounded-lg border border-slate-300 px-3 py-2 text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"><Square size={13} /></button></div>
    <p className="mt-2 text-[10px] text-slate-500">{receivedAt ? `Last capture ${new Date(receivedAt).toLocaleTimeString()}` : 'Audio appears after the next upload.'}</p>
  </div>;
}