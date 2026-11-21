import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LiveAudioProvider, useLiveAudio } from './useLiveAudio';

let dashboard;
let capture;
let blobCount;
vi.mock('./useDashboardData', () => ({ default: () => dashboard }));
function Probe({ page = 'dashboard' }) {
  const player = useLiveAudio();
  return <><span>{page}</span><span data-testid="status">{player.status}</span>
    <button onClick={player.pause}>Pause</button><button onClick={player.play}>Play</button></>;
}
const flush = async () => { await act(async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); }); };
const message = (meta) => window.dispatchEvent(new CustomEvent('foresight:audio-ready', { detail: meta }));
const meta = (id, scenario = 'one') => ({ beacon_id: 'B', capture_id: id, scenario_id: scenario,
  zone: 'zone_0_0', sound: 'chainsaw', is_simulated: true, received_at: new Date().toISOString(), expires_at: null });
const mount = () => render(<LiveAudioProvider><Probe /></LiveAudioProvider>);
beforeEach(() => {
  vi.useFakeTimers(); blobCount = 0; capture = meta('first');
  dashboard = { selectedBeaconId: 'B', setSelectedBeaconId: vi.fn(), simulator: { running: true,
    zones: { zone_0_0: { scenario_id: 'one', phase: 'detected' } } } };
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () { this.testPaused = true; });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () { this.testPaused = false; return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function () { return this.testPaused !== false; });
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (url.includes('/meta?')) return Promise.resolve({ ok: true, json: async () => capture });
    blobCount++;
    return Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(['wav']) });
  }));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:test-${blobCount}`), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('keeps one audio element and playback position across page changes', async () => {
  const view = mount(); await flush();
  const audio = screen.getByTestId('live-audio'); audio.currentTime = 7;
  const calls = HTMLMediaElement.prototype.play.mock.calls.length;
  view.rerender(<LiveAudioProvider><Probe page="simulation" /></LiveAudioProvider>); await flush();
  expect(screen.getByTestId('live-audio')).toBe(audio);
  expect(audio.currentTime).toBe(7);
  expect(audio.paused).toBe(false);
  expect(HTMLMediaElement.prototype.play.mock.calls.length).toBe(calls);
});
it('does not restart duplicate captures from the same scenario', async () => {
  mount(); await flush(); const audio = screen.getByTestId('live-audio'); audio.currentTime = 8;
  act(() => message(meta('second'))); await flush();
  expect(blobCount).toBe(1); expect(audio.currentTime).toBe(8); expect(audio.loop).toBe(true);
});
it('immediately fetches a changed scenario and respects expiry', async () => {
  mount(); await flush(); const count = HTMLMediaElement.prototype.play.mock.calls.length;
  const next = { ...meta('second', 'two'), expires_at: new Date(Date.now() + 1000).toISOString() };
  act(() => {
    window.dispatchEvent(new CustomEvent('foresight:simulation-status', { detail: { running: true, zones: { zone_0_0: { scenario_id: 'two' } } } }));
    message(next);
  }); await flush();
  expect(blobCount).toBe(2);
  expect(HTMLMediaElement.prototype.play.mock.calls.length).toBe(count + 1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByTestId('live-audio').paused).toBe(true);
  expect(screen.getByTestId('status').textContent).toBe('waiting');
});
it('manual pause survives route changes and incoming audio messages', async () => {
  const view = mount(); await flush(); fireEvent.click(screen.getByText('Pause'));
  const count = blobCount;
  view.rerender(<LiveAudioProvider><Probe page="simulation" /></LiveAudioProvider>);
  act(() => message(meta('second'))); await flush();
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(blobCount).toBe(count); expect(screen.getByTestId('live-audio').paused).toBe(true);
  expect(screen.getByTestId('status').textContent).toBe('paused');
});
it('retains only the newest pending hardware capture until the current clip ends', async () => {
  capture = { ...meta('first', null), is_simulated: false }; mount(); await flush();
  const audio = screen.getByTestId('live-audio'); const original = audio.src;
  act(() => message({ ...capture, capture_id: 'second' })); await flush();
  act(() => message({ ...capture, capture_id: 'third' })); await flush();
  expect(audio.src).toBe(original); expect(audio.loop).toBe(false);
  act(() => audio.dispatchEvent(new Event('ended'))); await flush();
  expect(audio.src).toContain('test-3');
});
it('recovers from a replaced capture and uses polling when websocket updates are missing', async () => {
  let conflict = true;
  fetch.mockImplementation((url) => {
    if (url.includes('/meta?')) return Promise.resolve({ ok: true, json: async () => capture });
    blobCount++;
    if (conflict) { conflict = false; capture = meta('newest'); return Promise.resolve({ status: 409 }); }
    return Promise.resolve({ ok: true, status: 200, blob: async () => new Blob(['wav']) });
  });
  mount(); await flush(); expect(screen.getByTestId('status').textContent).toBe('playing');
  capture = meta('other', 'two');
  act(() => window.dispatchEvent(new CustomEvent('foresight:simulation-status', { detail: { running: true, zones: { zone_0_0: { scenario_id: 'two' } } } })));
  const count = blobCount;
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
  expect(blobCount).toBe(count + 1);
});
it('pauses live playback for event replay and releases resources on unmount', async () => {
  const view = mount(); await flush();
  act(() => window.dispatchEvent(new Event('foresight:pause-live-audio')));
  expect(screen.getByTestId('live-audio').paused).toBe(true);
  view.unmount(); expect(vi.getTimerCount()).toBe(0);
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it('exposes a manual Play state if browser autoplay is denied', async () => {
  HTMLMediaElement.prototype.play.mockRejectedValue(new Error('NotAllowedError'));
  mount(); await flush(); expect(screen.getByTestId('status').textContent).toBe('ready');
});

it('does not overwrite an explicit pause when an in-flight download is aborted', async () => {
  fetch.mockImplementation((url, { signal } = {}) => {
    if (url.includes('/meta?')) return Promise.resolve({ ok: true, json: async () => capture });
    return new Promise((resolve, reject) => signal.addEventListener('abort',
      () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  });
  mount(); await flush(); fireEvent.click(screen.getByText('Pause')); await flush();
  expect(screen.getByTestId('status').textContent).toBe('paused');
  expect(screen.getByTestId('live-audio').paused).toBe(true);
});
