import { test as base, expect, request } from '@playwright/test';

const baseURL = process.env.VITE_API_URL || 'http://localhost:8000';
export const credentials = {
  login_id: process.env.FORESIGHT_LOGIN_ID || 'test-operator',
  password: process.env.FORESIGHT_LOGIN_PASSWORD || 'test-password',
};

export const test = base.extend({
  token: async ({ request: guest }, use) => {
    const response = await guest.post(baseURL + '/api/auth/login', { data: credentials });
    expect(response.ok(), 'Test backend must accept the configured test credentials').toBe(true);
    await use((await response.json()).access_token);
  },
  api: async ({ token }, use) => {
    const client = await request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    try {
      await use(client);
    } finally {
      await client.dispose();
    }
  },
  page: async ({ page, token }, use) => {
    await page.addInitScript((accessToken) => sessionStorage.setItem('foresight.access_token', accessToken), token);
    await use(page);
  },
});

export { expect };
