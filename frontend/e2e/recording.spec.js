import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures';

test('authenticates a local event recording and plays it', async ({ page, token }) => {
  const event = {
    id: 8675,
    beacon_id: 'BEACON_01',
    sound_class: 'Test recording',
    timestamp: new Date().toISOString(),
    threat_score: 0.2,
    final_score: 0.3,
    aci_value: 0.5,
    audio_file_url: '/uploads/browser-test.wav',
  };
  await page.route(/\/api\/events\?limit=500$/, (route) => route.fulfill({ json: [event] }));
  await page.route('**/api/events/8675', (route) => route.fulfill({ json: { event } }));
  await page.route('**/api/events/8675/correlation', (route) => route.fulfill({ json: { events: [], beacons: [] } }));
  await page.route('**/uploads/browser-test.wav', (route) => {
    expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
    const path = fileURLToPath(new URL('../../backend/audio/zones/ambient.wav', import.meta.url));
    return route.fulfill({ path, contentType: 'audio/wav' });
  });
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());

  await page.goto('/dashboard');
  await page.getByRole('button', { name: /Test recording/ }).click();
  const audio = page.locator('audio[controls]');
  await expect(audio).toHaveAttribute('src', /^blob:/);
  await page.getByRole('button', { name: 'Replay recording' }).click();
  await expect.poll(() => audio.evaluate((element) => element.currentTime)).toBeGreaterThan(0);
});
