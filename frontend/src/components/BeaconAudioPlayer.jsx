import { CircleNotch, Pause, Play, Radio, Stop } from '@phosphor-icons/react';
import { useLiveAudio } from '../hooks/useLiveAudio';
import Waveform from './Waveform';

export default function BeaconAudioPlayer() {
  const player = useLiveAudio();
  if (!player) return null;
  const { status, meta, error, play, pause, stop } = player;
  const playing = status === 'playing';
  const label = error || ({ loading: 'Loading capture...', waiting: 'Waiting for next capture', paused: 'Paused by you',
    ready: 'Press Play to allow audio', playing: 'Listening live' }[status] || 'Capture ready');
  return <div className="beacon-audio-player mt-4 rounded-2xl border border-moss-500/25 bg-white p-4 shadow-sm">
    <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[.14em] text-moss-500"><Radio size={12} /> LISTENING</p>
    <p aria-live="polite" className="mt-1 text-[10px] text-slate-500">{label}</p>
    {status === 'loading' && <CircleNotch size={16} className="animate-spin" />}
    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2"><Waveform playing={playing} /></div>
    <div className="mt-3 flex items-center gap-2">
      <button type="button" onClick={playing ? pause : play} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-moss-500 px-3 py-2 text-xs font-semibold text-white">
        {playing ? <Pause size={13} /> : <Play size={13} />}{playing ? 'Pause' : 'Play capture'}
      </button>
      <button type="button" onClick={stop} aria-label="Stop listening" className="rounded-lg border border-slate-300 px-3 py-2"><Stop size={13} /></button>
    </div>
    <p className="mt-2 text-[10px] text-slate-500">{meta ? `${meta.sound || meta.sound_class || 'Processing'} - ${new Date(meta.received_at).toLocaleTimeString()}` : 'Audio appears after the next capture.'}</p>
    <p className="mt-1 text-[10px] text-slate-500">Listening continues across pages until you pause.</p>
  </div>;
}
