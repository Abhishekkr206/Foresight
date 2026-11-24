import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
});

test('cached navigation is immediate and preserves shell and controls', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const NativeSocket = window.WebSocket;
    window.testSockets = [];
    window.WebSocket = class extends NativeSocket {
      constructor(...args) { super(...args); window.testSockets.push(this); }
    };
  });
  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Forest health', exact: true })).toBeVisible();
  await expect(page.locator('.dashboard-page-header')).toHaveCSS('opacity', '1');
  await expect(page.locator('.dashboard-intro-item-2')).toHaveCSS('opacity', '1');
  await expect(page.getByText('Loading events…')).toHaveCount(0);
  await page.getByLabel('Filter by severity').selectOption('high');
  await page.getByRole('button', { name: 'Collapse information panel' }).click();
  const timings = [];
  const warmup = [];
  const switchPage = (path, heading) => page.evaluate(({ path, heading }) => new Promise((resolve) => {
    const start = performance.now();
    const observer = new MutationObserver(() => {
      const visible = [...document.querySelectorAll('h1')].some((element) => element.textContent === heading && element.checkVisibility({ checkOpacity: true }));
      if (visible) {
        observer.disconnect();
        requestAnimationFrame(() => resolve(performance.now() - start));
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });
    document.querySelector(`a[href="${path}"]`).click();
  }), { path, heading });
  for (let i = 0; i < 6; i++) {
    const samples = i === 0 ? warmup : timings;
    samples.push(await switchPage('/simulation', 'Scenario controls'));
    await expect(page.getByRole('heading', { name: 'Scenario controls' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expand information panel' })).toBeVisible();
    samples.push(await switchPage('/dashboard', 'Forest health'));
    await expect(page.getByRole('heading', { name: 'Forest health', exact: true })).toBeVisible();
    await expect(page.getByLabel('Filter by severity')).toHaveValue('high');
    await expect(page.getByText('Loading forest signal')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  await expect.poll(() => page.evaluate(() => window.testSockets.filter((socket) => socket.readyState === 1 && new URL(socket.url).pathname === '/ws').length)).toBe(1);
  console.log('cached_navigation_ms=' + JSON.stringify(timings.map(Math.round)));
  console.log('warmup_navigation_ms=' + JSON.stringify(warmup.map(Math.round)));
  expect(Math.max(...timings)).toBeLessThan(200);
});

test('a hanging summary cannot block navigation or other content', async ({ page }) => {
  let summaryRoute;
  await page.route('**/api/summary', (route) => { summaryRoute = route; });
  await page.goto('/dashboard');
  await expect(page.getByRole('link', { name: 'Scenarios' })).toBeVisible();
  await expect(page.getByText('Loading forest signal')).toHaveCount(0);
  await page.getByRole('link', { name: 'Scenarios' }).click();
  await expect(page.getByRole('heading', { name: 'Scenario controls' })).toBeVisible();
  await page.getByRole('link', { name: 'Monitor' }).click();
  await expect(page.getByRole('heading', { name: 'Forest health', exact: true })).toBeVisible();
  await summaryRoute.fulfill({ status: 503, body: 'Summary temporarily unavailable' });
  await expect(page.getByRole('alert')).toContainText('Summary temporarily unavailable');
  await expect(page.getByRole('link', { name: 'Scenarios' })).toBeEnabled();
  await page.unroute('**/api/summary');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('scenario controls remain usable after repeated route switches', async ({ page, api }) => {
  test.setTimeout(90000);
  await api.post('/api/simulation/start');
  await page.goto('/simulation');
  await expect(page.getByRole('button', { name: 'Stop simulation' })).toBeEnabled();
  await page.getByRole('button', { name: 'Stop simulation' }).click();
  // Stop deliberately finishes the current capture, including a cold model load.
  await expect(page.getByRole('button', { name: 'Start simulation' })).toBeEnabled({ timeout: 60000 });
  await page.getByRole('link', { name: 'Monitor' }).click();
  await page.getByRole('link', { name: 'Scenarios' }).click();
  await page.getByRole('button', { name: 'Start simulation' }).click();
  await expect(page.getByRole('button', { name: 'Stop simulation' })).toBeEnabled();
});
