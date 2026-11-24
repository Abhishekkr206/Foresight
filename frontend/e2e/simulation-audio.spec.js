import { test, expect } from './fixtures';

test('trigger availability is explained and enabled actions look different', async ({ page, api }) => {
  await api.post('/api/simulation/start');
  await page.goto('/simulation');
  const zone = page.getByLabel('Selected zone', { exact: true });
  const trigger = page.getByRole('button', { name: 'Trigger chainsaw now', exact: true });
  await zone.selectOption('zone_0_1');
  await expect(trigger).toBeDisabled();
  await expect(page.locator('#trigger-reason')).toContainText('no simulated beacons');
  const disabledColor = await trigger.evaluate((element) => getComputedStyle(element).backgroundColor);
  await zone.selectOption('zone_0_0');
  await expect(trigger).toBeEnabled();
  await expect(page.locator('#trigger-reason')).toContainText('BEACON_07');
  await expect(trigger).toHaveCSS('background-color', 'rgb(31, 61, 43)');
  expect(await trigger.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(disabledColor);
  await expect(trigger).toHaveCSS('opacity', '1');
  await expect(zone.locator('option:checked')).toContainText('1 simulated beacons');
  const response = page.waitForResponse((response) => response.url().endsWith('/api/simulation/trigger') && response.request().method() === 'POST');
  await trigger.click();
  const accepted = (await (await response).json()).accepted_scenario;
  expect(accepted.beacon_ids).toEqual(['BEACON_07']);
  // Triggering does not select an audio source on the user's behalf.
  await expect(page.getByTestId('live-audio')).not.toHaveAttribute('src');
  await expect(page.getByRole('button', { name: 'Listen to BEACON_07' })).toBeVisible();
});

test('chainsaw capture arrives promptly and playback survives new captures and page switches', async ({ page, api }) => {
  test.setTimeout(90000);
  await api.post('/api/simulation/start');
  await expect.poll(async () => (await (await api.get('/api/simulation/status')).json()).worker_phase,
    { timeout: 60000 }).toBe('ready');
  const ready = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('websocket', (socket) => socket.on('framereceived', ({ payload }) => {
    try {
      const message = JSON.parse(payload);
      if (message.type === 'audio.ready') ready.push({ ...message.data, received: Date.now() });
    } catch {}
  }));
  await page.goto('/simulation');
  await page.locator('.beacon-sidebar-row').filter({ hasText: 'BEACON_07' }).click();
  await expect.poll(() => page.getByTestId('live-audio').getAttribute('src')).toBeTruthy();
  if (await page.getByTestId('live-audio').evaluate((element) => element.paused)) {
    await page.getByRole('button', { name: 'Play capture', exact: true }).click();
  }
  await page.evaluate(() => {
    window.audioPlayingTimes = [];
    window.originalAudio = document.querySelector('[data-testid="live-audio"]');
    window.originalAudio.addEventListener('playing', () => window.audioPlayingTimes.push({ time: Date.now(), src: window.originalAudio.src }));
  });
  await page.getByLabel('Selected zone', { exact: true }).selectOption('zone_0_0');
  await page.getByLabel('Duration', { exact: true }).selectOption('30');
  const previousSrc = await page.getByTestId('live-audio').getAttribute('src');
  const response = page.waitForResponse((response) => response.url().endsWith('/api/simulation/trigger') && response.request().method() === 'POST');
  const start = Date.now();
  await page.getByRole('button', { name: 'Trigger chainsaw now', exact: true }).click();
  const accepted = (await (await response).json()).accepted_scenario;
  await expect.poll(() => ready.filter((item) => item.scenario_id === accepted.scenario_id && item.beacon_id === 'BEACON_07').length).toBeGreaterThan(0);
  const first = ready.find((item) => item.scenario_id === accepted.scenario_id && item.beacon_id === 'BEACON_07');
  expect(first.received - start).toBeLessThan(3000);
  await expect(page.getByTestId('live-audio')).not.toHaveAttribute('src', previousSrc);
  await expect.poll(() => page.evaluate(() => window.audioPlayingTimes.filter((item) => item.src === window.originalAudio.src).length)).toBeGreaterThan(0);
  const playing = await page.evaluate(() => window.audioPlayingTimes.find((item) => item.src === window.originalAudio.src).time);
  expect(playing - first.received).toBeGreaterThanOrEqual(0);
  expect(playing - first.received).toBeLessThan(500);
  console.log(JSON.stringify({ trigger_to_audio_ready_ms: first.received - start, ready_to_playing_ms: playing - first.received }));
  const src = await page.getByTestId('live-audio').getAttribute('src');
  await expect.poll(() => new Set(ready.filter((item) => item.scenario_id === accepted.scenario_id && item.beacon_id === 'BEACON_07').map((item) => item.capture_id)).size,
    { timeout: 15000 }).toBeGreaterThan(1);
  await expect(page.getByTestId('live-audio')).toHaveAttribute('src', src);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Monitor', exact: true }).click();
  await page.getByRole('link', { name: 'Scenarios', exact: true }).click();
  expect(await page.evaluate(() => window.originalAudio === document.querySelector('[data-testid="live-audio"]'))).toBe(true);
  expect(await page.getByTestId('live-audio').evaluate((element) => element.paused)).toBe(false);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('link', { name: 'Monitor', exact: true }).click();
  expect(await page.getByTestId('live-audio').evaluate((element) => element.paused)).toBe(true);
  expect(errors).toEqual([]);
  // Restore this test zone without affecting listening selection or other zones.
  await api.post('/api/simulation/trigger', { data: { zone: 'zone_0_0', sound: 'ambient', duration_seconds: 10 } });
});
