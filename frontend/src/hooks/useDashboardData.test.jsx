import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Link, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useDashboardData, { DashboardDataProvider } from './useDashboardData';
import { getJson } from '../services/api';

let sockets;
let pending;
const beacons = [{ beacon_id: 'BEACON_02', latitude: -4, longitude: -55, is_real_hardware: false }];
class Socket {
  constructor() { sockets.push(this); this.closed = false; }
  close() { this.closed = true; this.onclose?.(); }
  message() { this.onmessage?.({ data: JSON.stringify({ type: 'event.created', data: { beacon_id: 'BEACON_02' } }) }); }
}
function Probe() {
  const data = useDashboardData();
  return <><Link to="/dashboard">Monitor</Link><Link to="/simulation">Scenarios</Link>
    <span data-testid="route">{useLocation().pathname}</span>
    <span data-testid="beacons">{data.beacons.length}</span>
    <span data-testid="events">{data.events.length}</span>
    <span data-testid="zone">{data.selectedZone}</span>
    <span data-testid="summary">{String(Boolean(data.loaded.summary))}</span>
    <span data-testid="errors">{JSON.stringify(data.resourceErrors)}</span>
    <span data-testid="notice">{data.simulationNotice?.text}</span>
    <button onClick={data.trigger}>Trigger scenario</button>
    <span data-testid="transcript">{JSON.stringify(data.assistantMessages)}</span>
    <form onSubmit={data.askAssistant}>
      <input aria-label="Assistant question" value={data.assistantPrompt} onChange={(event) => data.setAssistantPrompt(event.target.value)} />
      <button>Send chat</button>
    </form>
    <button onClick={data.newChat}>New chat</button>
    <button onClick={() => data.setSelectedZone('zone_2_2')}>Choose zone</button>
    <button onClick={() => data.refresh('summary')}>Retry summary</button>
  </>;
}
const flush = async () => { await act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); }); };
function mount(path = '/dashboard') {
  return render(<StrictMode><MemoryRouter initialEntries={[path]}><DashboardDataProvider><Probe /></DashboardDataProvider></MemoryRouter></StrictMode>);
}
beforeEach(() => {
  vi.useFakeTimers(); sockets = []; pending = new Map();
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
    const path = new URL(url).pathname;
    if (pending.has(path)) return new Promise((resolve, reject) => {
      pending.get(path).push(resolve);
      options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    const body = path === '/api/beacons' ? beacons : path === '/api/events' ? [{ id: 7, beacon_id: 'BEACON_02', final_score: 0 }] : path === '/api/summary' ? { forest_health_score: 92 } : path === '/api/simulation/status' ? { running: true, zones: {} } : [];
    return Promise.resolve({ ok: true, json: async () => body });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('shared route data', () => {
  it('sends bounded conversation history and selection, and clears history for a new chat', async () => {
    const original = fetch.getMockImplementation();
    const bodies = [];
    fetch.mockImplementation((url, options) => {
      if (!url.includes('/api/assistant/query')) return original(url, options);
      bodies.push(JSON.parse(options.body));
      return Promise.resolve({ ok:true, json:async () => ({ answer:'A'.repeat(2000), mode:'local_data', used_llm:false,
        model:'gemini-3.1-flash-lite', fallback_reason:'invalid_credentials' }) });
    });
    mount(); await flush();
    for (let i=0;i<8;i++) {
      fireEvent.change(screen.getByLabelText('Assistant question'), { target:{ value:i ? 'which zone?' : 'any threats?' } });
      fireEvent.click(screen.getByText('Send chat')); await flush();
    }
    expect(bodies[0].history).toEqual([]);
    expect(bodies[1].history.map((turn) => turn.role)).toEqual(['user','assistant']);
    expect(bodies[1].history[0].text).toBe('any threats?');
    expect(bodies.at(-1).history.length).toBeLessThanOrEqual(12);
    expect(bodies.at(-1).history.reduce((sum, turn) => sum+turn.text.length,0)).toBeLessThanOrEqual(12000);
    expect(bodies[0].selection.zone_id).toBe('zone_0_0');
    fireEvent.click(screen.getByText('New chat')); await flush();
    expect(screen.getByTestId('transcript').textContent).toBe('[]');
    fireEvent.change(screen.getByLabelText('Assistant question'), { target:{ value:'hello' } });
    fireEvent.click(screen.getByText('Send chat')); await flush();
    expect(bodies.at(-1).history).toEqual([]);
  });
  it('confirms a scenario only for its matching scenario ID and affected beacon', async () => {
    const original = fetch.getMockImplementation();
    const accepted = { scenario_id: 'new-scenario', zone: 'zone_0_0', sound: 'chainsaw', beacon_ids: ['BEACON_02'] };
    fetch.mockImplementation((url, options) => url.includes('/api/simulation/trigger')
      ? Promise.resolve({ ok: true, json: async () => ({ running: true,
        zones: { zone_0_0: { scenario_id: 'new-scenario', phase: 'queued' } }, accepted_scenario: accepted }) })
      : original(url, options));
    mount('/simulation'); await flush();
    fireEvent.click(screen.getByText('Trigger scenario')); await flush();
    expect(screen.getByTestId('notice').textContent).toContain('Queued');
    const socket = sockets.find((item) => !item.closed);
    const event = (scenario_id, beacon_id) => act(() => socket.onmessage({ data: JSON.stringify({
      type: 'event.created', scenario_id, data: { beacon_id },
    }) }));
    event('old-scenario', 'BEACON_02'); await flush();
    event('new-scenario', 'OTHER'); await flush();
    expect(screen.getByTestId('notice').textContent).toContain('Queued');
    event('new-scenario', 'BEACON_02'); await flush();
    expect(screen.getByTestId('notice').textContent).toContain('Detected');
  });
  it('preserves cached data and selections through repeated navigation with one live socket', async () => {
    mount(); await flush();
    expect(screen.getByTestId('events').textContent).toBe('1');
    fireEvent.click(screen.getByText('Choose zone'));
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByText('Scenarios'));
      expect(screen.getByTestId('beacons').textContent).toBe('1');
      fireEvent.click(screen.getByText('Monitor'));
      expect(screen.getByTestId('events').textContent).toBe('1');
    }
    await flush();
    expect(screen.getByTestId('zone').textContent).toBe('zone_2_2');
    expect(sockets.filter((socket) => !socket.closed)).toHaveLength(1);
    const count = fetch.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(fetch.mock.calls.length).toBe(count);
  });
  it('does not fetch events or ACI on an initial simulation visit', async () => {
    mount('/simulation'); await flush();
    expect(fetch.mock.calls.some(([url]) => /\/api\/(events|aci)/.test(url))).toBe(false);
    expect(screen.getByTestId('beacons').textContent).toBe('1');
  });
  it('keeps other data and navigation usable when summary times out, then retries', async () => {
    pending.set('/api/summary', []);
    mount(); await flush();
    expect(screen.getByTestId('events').textContent).toBe('1');
    expect(screen.getByTestId('summary').textContent).toBe('false');
    fireEvent.click(screen.getByText('Scenarios'));
    expect(screen.getByTestId('route').textContent).toBe('/simulation');
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(screen.getByTestId('errors').textContent).toContain('timed out');
    pending.delete('/api/summary');
    fireEvent.click(screen.getByText('Retry summary')); await flush();
    expect(screen.getByTestId('summary').textContent).toBe('true');
    expect(screen.getByTestId('errors').textContent).not.toContain('timed out');
  });
  it('coalesces websocket bursts and queues only one follow-up per pending resource', async () => {
    mount(); await flush();
    pending.set('/api/summary', []);
    const socket = sockets.find((item) => !item.closed);
    for (let i = 0; i < 20; i++) socket.message();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(pending.get('/api/summary')).toHaveLength(1);
    for (let i = 0; i < 20; i++) socket.message();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(pending.get('/api/summary')).toHaveLength(1);
    await act(async () => { pending.get('/api/summary')[0]({ ok: true, json: async () => ({ forest_health_score: 80 }) }); });
    expect(pending.get('/api/summary')).toHaveLength(2);
  });
  it('reconnects after socket loss and cleans up timers on unmount', async () => {
    const view = mount(); await flush();
    sockets.find((item) => !item.closed).close();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(sockets.filter((socket) => !socket.closed)).toHaveLength(1);
    const count = fetch.mock.calls.length;
    act(() => sockets.find((socket) => !socket.closed).onopen()); await flush();
    expect(fetch.mock.calls.length).toBeGreaterThan(count);
    view.unmount();
    expect(sockets.every((socket) => socket.closed)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('discards an obsolete event request when leaving the dashboard', async () => {
    pending.set('/api/events', []); mount(); await flush();
    fireEvent.click(screen.getByText('Scenarios')); await flush();
    await act(async () => { for (const resolve of pending.get('/api/events')) resolve({ ok: true, json: async () => [{ id: 99 }] }); });
    expect(screen.getByTestId('events').textContent).toBe('0');
  });
});

it('retains timeout protection until the response body has loaded', async () => {
  fetch.mockImplementation((url, { signal }) => Promise.resolve({ ok: true, json: () => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  }) }));
  const result = getJson('/api/beacons').catch((error) => error);
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect((await result).message).toContain('timed out');
});
