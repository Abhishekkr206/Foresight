import { ActivityIcon, Waveform, CaretLeft, CaretRight, MapPin, PaperPlaneTilt, X } from '@phosphor-icons/react';

export default function AssistantPanel({ messages, prompt, onPromptChange, onSubmit, busy, highlighted, highlightedBeacons = [], highlightedEvents = [], onBeaconSelect, onClear, open = true, onToggle }) {
  return <aside className={"assistant-rail dashboard-assistant " + (open ? "" : "assistant-collapsed")}>
    <button onClick={onToggle} aria-label={open ? "Collapse assistant panel" : "Expand assistant panel"} className="assistant-toggle flex h-7 w-7 items-center justify-center rounded-lg border bg-white text-slate-700">
      {open ? <CaretRight weight="duotone" size={16} /> : <CaretLeft weight="duotone" size={16} />}
    </button>
    {!open && <div className="assistant-collapsed-identity" aria-label="AI assistant"><Waveform weight="duotone" size={17} /><span>AI</span></div>}
    {open && <>
      <div className="assistant-header flex items-start gap-3 pr-8 mt-5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-moss-500 text-white"><Waveform weight="duotone" size={18} /></span><div><p className="text-[10px] font-semibold tracking-[.16em] text-moss-500">FOREST SIGNAL</p><h2 className="mt-1 font-semibold text-slate-900">Ask the forest</h2><p className="mt-1 text-xs text-slate-600">Ask about coverage, threats, beacon status, or ACI.</p></div></div>
      <div className="assistant-messages mt-6 flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && <div className="assistant-empty rounded-xl bg-slate-100 p-4"><p className="text-xs font-semibold text-slate-700">Ask about the forest</p><p className="mt-1 text-sm text-slate-500">Try “which beacons are active?”</p></div>}
        {messages.map((message, index) => <div key={index} className={"assistant-message rounded-xl p-3.5 " + (message.role === "user" ? "assistant-message-user ml-8" : "assistant-message-ai mr-2")}>
          {message.role === "assistant" && <div className="mb-2 flex items-center justify-between gap-2"><span className="flex items-center gap-1.5 text-[10px] font-bold tracking-[.14em] text-moss-500"><Waveform weight="duotone" size={13} /> FOREST INSIGHT</span>{message.fallback ? <span className="text-[10px] text-slate-500">LOCAL FALLBACK</span> : <span className="text-[10px] text-slate-500">GEMINI</span>}</div>}
          <p className="whitespace-pre-line text-sm leading-6">{message.text}</p>
          {message.role === "assistant" && message.context?.type === "forest_summary" && message.context.active_threat_count > 0 && <p className="mt-3 inline-flex items-center rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-700">{message.context.active_threat_count} active threat{message.context.active_threat_count === 1 ? "" : "s"}</p>}
          {message.role === "assistant" && message.highlightedBeaconIds?.length > 0 && <div className="mt-3 border-t border-slate-200/80 pt-3"><p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold tracking-[.12em] text-slate-500"><MapPin weight="duotone" size={12} /> MAP FOCUS</p><div className="flex flex-wrap gap-1.5">{message.highlightedBeaconIds.map((beaconId) => <button key={beaconId} type="button" onClick={() => onBeaconSelect?.(beaconId)} className="rounded-lg border border-moss-500/30 bg-white px-2.5 py-1.5 text-xs font-semibold text-moss-500 transition hover:border-moss-500 hover:bg-moss-500/10">{beaconId}</button>)}</div></div>}
          {message.role === "assistant" && message.highlightedEventCount > 0 && <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-600"><ActivityIcon weight="duotone" size={13} className="text-moss-500" /> {message.highlightedEventCount} matching event{message.highlightedEventCount === 1 ? "" : "s"} highlighted</p>}
        </div>)}
      </div>
      <form onSubmit={onSubmit} className="assistant-form mt-5 flex gap-2"><input value={prompt} onChange={(event) => onPromptChange(event.target.value)} placeholder="Ask about events, status, or ACI..." className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2.5 text-sm outline-none focus:ring-1 focus:ring-moss-500" /><button aria-label="Send question" disabled={busy || !prompt.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-moss-500 text-white disabled:opacity-40"><PaperPlaneTilt weight="duotone" size={15} /></button></form>
      {highlighted && <button onClick={onClear} className="mt-3 flex items-center gap-1 text-xs text-moss-500 hover:text-slate-900"><X weight="duotone" size={13} /> Clear highlights</button>}
    </>}
  </aside>;
}