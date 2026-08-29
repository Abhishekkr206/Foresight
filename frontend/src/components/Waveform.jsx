export default function Waveform({ playing }) {
  return <div className="flex h-8 items-center gap-0.5" aria-label={playing ? 'Audio playing' : 'Audio paused'}>{Array.from({ length: 28 }, (_, index) => <span key={index} className={`w-1 rounded-full bg-moss-500/80 ${playing ? 'wave-bar' : ''}`} style={{ height: `${8 + ((index * 17) % 20)}px`, animationDelay: `${index * 35}ms` }} />)}</div>;
}