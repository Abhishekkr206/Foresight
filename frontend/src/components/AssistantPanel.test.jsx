import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AssistantPanel from './AssistantPanel';

afterEach(cleanup);
const props = () => ({ messages: [], prompt: 'hello', onPromptChange: vi.fn(), onSubmit: vi.fn((event) => event.preventDefault()),
  onNewChat: vi.fn(), onToggle: vi.fn(), status: { state: 'unavailable', configured_model: 'gemini-3.1-flash-lite', fallback_reason: 'invalid_credentials' } });

it('shows Foresight AI branding without connection labels or repeated banners', () => {
  render(<AssistantPanel {...props()} messages={[{ role:'assistant', text:'Hi!' }, { role:'user', text:'Which zone?' }, { role:'assistant', text:'zone_0_0.' }]} />);
  expect(screen.getByRole('heading', { name:'Foresight AI' })).toBeTruthy();
  expect(screen.queryByText('Local data')).toBeNull();
  expect(screen.queryByTestId('assistant-status')).toBeNull();
  expect(screen.queryByText('LOCAL FALLBACK')).toBeNull();
  expect(screen.queryByText('FOREST INSIGHT')).toBeNull();
  expect(screen.getByRole('log', { name:'Conversation' }).textContent).toContain('zone_0_0');
});

it('submits Enter while preserving Shift+Enter and IME composition', () => {
  const value = props(); render(<AssistantPanel {...value} />);
  const input = screen.getByRole('textbox', { name:'Message Foresight AI' });
  fireEvent.keyDown(input, { key:'Enter', shiftKey:true });
  fireEvent.keyDown(input, { key:'Enter', isComposing:true });
  expect(value.onSubmit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key:'Enter' });
  expect(value.onSubmit).toHaveBeenCalledTimes(1);
  expect(input.maxLength).toBe(500);
});

it('keeps a scrolled-up reader in place and offers a jump to the new reply', () => {
  const value = props();
  const view = render(<AssistantPanel {...value} messages={[{role:'assistant',text:'First answer'}]} />);
  const log = screen.getByRole('log');
  Object.defineProperty(log, 'scrollHeight', { configurable:true, value:1000 });
  Object.defineProperty(log, 'clientHeight', { configurable:true, value:200 });
  log.scrollTop = 100; fireEvent.scroll(log);
  view.rerender(<AssistantPanel {...value} messages={[{role:'assistant',text:'First answer'}, {role:'assistant',text:'New answer'}]} />);
  expect(log.scrollTop).toBe(100);
  fireEvent.click(screen.getByRole('button', {name:'New message'}));
  expect(log.scrollTop).toBe(1000);
  expect(screen.queryByRole('button', {name:'New message'})).toBeNull();
});

it('provides a new-chat action and an accessible pending state', () => {
  const value = props(); render(<AssistantPanel {...value} busy />);
  expect(screen.getByRole('status').textContent).toBe('Thinking...');
  expect(screen.getByRole('button', {name:'Send question'}).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', {name:'New chat'}));
  expect(value.onNewChat).toHaveBeenCalledTimes(1);
});
