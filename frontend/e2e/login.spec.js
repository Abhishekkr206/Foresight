import { test, expect } from '@playwright/test';
import { credentials } from './fixtures';

async function signIn(page) {
  await page.getByLabel('Login ID').fill(credentials.login_id);
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) => route.abort());
});

test('requires login and restores a direct route after sign-in', async ({ page }) => {
  await page.goto('/simulation');
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Login ID').fill(credentials.login_id);
  await page.getByLabel('Password').fill(credentials.password + '-invalid');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toHaveText('Invalid login ID or password.');
  await page.getByLabel('Password').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/simulation$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Scenario controls' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in to Foresight' })).toBeVisible();
});

test('clears the browser session when the token expires', async ({ page }) => {
  await page.clock.install();
  await page.goto('/login');
  await signIn(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.clock.fastForward('01:00:01');
  await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(() => sessionStorage.getItem('foresight.access_token'))).toBeNull();
});

test('returns to login when a protected request rejects the token', async ({ page }) => {
  await page.route('**/api/simulation/status', (route) => route.fulfill({ status: 401 }));
  await page.goto('/simulation');
  await expect(page).toHaveURL(/\/login$/);
  const rejected = page.waitForResponse('**/api/simulation/status');
  await signIn(page);
  expect((await rejected).status()).toBe(401);
  await expect(page.getByRole('heading', { name: 'Sign in to Foresight' })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('foresight.access_token'))).toBeNull();
});
