import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { endSession, getJson } from '../services/api';

export default function AudioDiagnosticsPage() {
  const [params] = useSearchParams();
  const beacon = params.get('beacon_id') || 'BEACON_01';
  const [capture, setCapture] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    let timer;
    setCapture(null);
    setError('');
    async function refresh() {
      try {
        const result = await getJson(
          `/api/debug/audio/latest/waveform?beacon_id=${encodeURIComponent(beacon)}&points=1200`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setCapture(result);
        setError('');
      } catch {
        if (!controller.signal.aborted) setError('Unable to load the waveform.');
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(refresh, 1000);
      }
    }
    refresh();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [beacon]);

  const values = capture?.values ?? [];
  const points = values.map((value, i) => `${i * 1200 / Math.max(1, values.length - 1)},${180 - value * 155}`).join(' ');

  return <main className="mx-auto max-w-6xl space-y-4 p-6">
    <nav className="flex justify-between"><Link to="/dashboard" className="underline">Dashboard</Link>
      <button onClick={endSession} className="underline">Sign out</button></nav>
    <h1 className="text-xl font-semibold">Microphone waveform for {beacon}</h1>
    <p role="status">{error || (capture?.available
      ? `${capture.duration_seconds} s · RMS ${capture.rms.toFixed(4)} · Peak ${capture.peak.toFixed(4)} · Received ${capture.received_at}`
      : capture?.message || 'Waiting for a capture…')}</p>
    <svg aria-label="Latest audio waveform" className="h-80 w-full rounded-xl border bg-white" viewBox="0 0 1200 360" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke="#477a52" strokeWidth="2" />
    </svg>
  </main>;
}
