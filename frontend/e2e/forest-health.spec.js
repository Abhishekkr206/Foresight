import { test, expect } from './fixtures';

function summary(overrides = {}) {
  return { beacon_count: 9, active_beacon_count: 9, confirmed_events_today: 0,
    forest_health_score: 95.6, aci_health_score: 100, active_threat_penalty: 4.4,
    active_threat_count: 1, observed_zone_count: 8, populated_zone_count: 8,
    affected_zone_count: 1, total_zone_count: 16, health_window_minutes: 5,
    zones: Array.from({ length: 16 }, (_, i) => ({ zone_id: `zone_${Math.floor(i / 4)}_${i % 4}`,
      configured_beacon_count: i < 8 ? 1 : 0, reporting_beacon_count: i < 8 ? 1 : 0,
      health_score: i === 0 ? 65 : i < 8 ? 100 : null,
      active_threat_count: i === 0 ? 1 : 0, active_threat_penalty: i === 0 ? 35 : 0 })), ...overrides };
}

test('a local incident shows the main score and one concise alert', async ({ page }) => {
  await page.route('**/api/summary', (route) => route.fulfill({ json: summary() }));
  await page.goto('/dashboard');
  await expect(page.locator('.dashboard-health-number')).toHaveText('95.6%');
  await expect(page.locator('.sidebar-health')).toContainText('95.6%');
  await expect(page.getByTestId('health-impact')).toHaveText('1 zone affected');
  await expect(page.locator('main')).toContainText('8 zones monitored');
  await expect(page.getByTestId('selected-zone-health')).toHaveCount(0);
  await expect(page.getByTestId('health-coverage')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('percentage points');
});

test('missing audio produces no headline health estimate', async ({ page }) => {
  await page.route('**/api/summary', (route) => route.fulfill({ json: summary({ forest_health_score: null,
    aci_health_score: null, active_threat_penalty: 0, active_threat_count: 0,
    observed_zone_count: 0, affected_zone_count: 0, zones: [] }) }));
  await page.goto('/dashboard');
  await expect(page.locator('.dashboard-health-number')).toHaveText('\u2014');
  await expect(page.locator('.sidebar-health')).toContainText('Waiting for recent audio');
  await expect(page.locator('.dashboard-page-header')).toContainText('Waiting for recent audio');
  await expect(page.getByTestId('health-coverage')).toContainText('Limited coverage: 0 of 8');
});

test('partial coverage remains visible beside the current health estimate', async ({ page }) => {
  await page.route('**/api/summary', (route) => route.fulfill({ json: summary({ forest_health_score: 80,
    aci_health_score: 80, active_threat_penalty: 0, active_threat_count: 0,
    observed_zone_count: 1, affected_zone_count: 0 }) }));
  await page.goto('/dashboard');
  await expect(page.locator('.dashboard-health-number')).toHaveText('80%');
  await expect(page.getByTestId('health-coverage')).toContainText('Limited coverage: 1 of 8');
  await expect(page.getByTestId('health-impact')).toHaveCount(0);
});
