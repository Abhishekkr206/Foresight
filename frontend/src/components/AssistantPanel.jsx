import { useEffect, useRef, useState } from 'react';
import { Waveform, PaperPlaneTilt, Plus, X } from '@phosphor-icons/react';
import RailToggle from './RailToggle';

export default function AssistantPanel({ messages, prompt, onPromptChange, onSubmit, busy, onNewChat,
  highlighted, onBeaconSelect, onClear, open = true, onToggle }) {
  const logRef = useRef(null);
  const inputRef = useRef(null);
  const nearBottom = useRef(true);
  const [newMessage, setNewMessage] = useState(false);
  const scrollEnd = () => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
    nearBottom.current = true; setNewMessage(false);
  };
  useEffect(() => {
    if (messages.length === 0) nearBottom.current = true;
    if (nearBottom.current) scrollEnd(); else setNewMessage(true);
  }, [messages.length, busy, open]);
  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = '48px';
    inputRef.current.style.height = `${Math.min(120, Math.max(48, inputRef.current.scrollHeight))}px`;
  }, [prompt, open]);
  return <aside aria-label="Forest assistant" className={`assistant-rail dashboard-assistant ${open ? '' : 'assistant-collapsed'}`}>
    <RailToggle side="right" open={open} label="assistant panel" onToggle={onToggle} />
    {!open && <div className="assistant-collapsed-identity" aria-label="AI assistant"><Waveform size={17} /><span>AI</span></div>}
    <div className="assistant-body" inert={!open}>
      <header className="assistant-header assistant-header-compact">
        <div className="assistant-heading"><span className="assistant-heading-icon"><Waveform size={18} /></span><div><h2 className="font-semibold">Foresight AI</h2><p>Forest monitoring assistant</p></div></div>
        <div className="assistant-header-actions"><button type="button" onClick={onNewChat} aria-label="New chat" title="New chat" className="assistant-new-chat"><Plus size={17} /></button></div>
      </header>
      <div ref={logRef} role="log" aria-label="Conversation" aria-live="polite" className="assistant-messages"
        onScroll={() => { const log = logRef.current; nearBottom.current = log.scrollHeight - log.scrollTop - log.clientHeight < 80; if (nearBottom.current) setNewMessage(false); }}>
        {messages.length === 0 && <div className="assistant-welcome"><span className="assistant-welcome-icon"><Waveform size={22} /></span><p className="assistant-empty-prompt">What would you like to check?</p><p>Ask about forest health, beacons, or recent events.</p></div>}
        {messages.map((message, index) => <div key={index} className={`assistant-message ${message.role === 'user' ? 'assistant-message-user' : 'assistant-message-ai'}`}>
          <p className="assistant-content">{message.text}</p>
          {!!message.highlightedBeaconIds?.length && <div className="assistant-beacon-links">{message.highlightedBeaconIds.map((id) =>
            <button type="button" key={id} onClick={() => onBeaconSelect?.(id)}>{id}</button>)}</div>}
        </div>)}
        {busy && <p role="status" className="assistant-thinking">Thinking...</p>}
      </div>
      {newMessage && <button type="button" onClick={scrollEnd} className="assistant-jump">New message</button>}
      <form onSubmit={onSubmit} className="assistant-form">
        <textarea ref={inputRef} aria-label="Message Foresight AI" value={prompt} maxLength={500} rows={1}
          onChange={(event) => onPromptChange(event.target.value)} placeholder="Ask a question..."
          onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault(); if (!busy && prompt.trim()) event.currentTarget.form.requestSubmit();
          } }} />
        <button aria-label="Send question" disabled={busy || !prompt.trim()} className="assistant-send"><PaperPlaneTilt size={18} /></button>
      </form>
      {highlighted && <button onClick={onClear} className="assistant-clear"><X size={13} /> Clear highlights</button>}
    </div>
  </aside>;
}
