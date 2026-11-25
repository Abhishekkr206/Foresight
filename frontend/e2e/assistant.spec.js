import { test, expect } from './fixtures';

test('the original typo and follow-up conversation identifies a live threatened zone', async ({ page, api }) => {
  test.setTimeout(120000);
  await api.post('/api/simulation/start');
  await expect.poll(async () => (await (await api.get('/api/simulation/status')).json()).worker_phase,
    { timeout:60000 }).toBe('ready');
  const response = await api.post('/api/simulation/trigger', { data:{ zone:'zone_0_0', sound:'chainsaw', duration_seconds:60 } });
  expect(response.ok()).toBe(true);
  await expect.poll(async () => (await (await api.get('/api/simulation/status')).json()).zones.zone_0_0.phase).toBe('detected');
  try {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/dashboard');
    const input = page.getByRole('textbox', { name:'Message Foresight AI' });
    const ask = async (question) => {
      await input.fill(question);
      const result = page.waitForResponse((response) => response.url().endsWith('/api/assistant/query'));
      await input.press('Enter');
      const response = await result;
      expect(response.ok()).toBe(true);
      const data = await response.json();
      await expect(page.getByRole('status').filter({hasText:'Thinking...'})).toHaveCount(0);
      return { data, request:response.request().postDataJSON() };
    };
    await ask('hi');
    const first = await ask('is any zone have any thereats');
    expect(first.data.answer).toContain('zone_0_0');
    const followup = await ask('which zone?');
    expect(followup.data.answer).toContain('zone_0_0');
    expect(followup.request.history.some((turn) => turn.text === 'is any zone have any thereats')).toBe(true);
    expect(followup.data.model).toBe('gemini-3.1-flash-lite');
    if (!followup.data.used_llm) {
      await expect(page.getByRole('heading', {name:'Foresight AI'})).toBeVisible();
      await expect(page.getByText('Local data', {exact:true})).toHaveCount(0);
      expect(followup.data.fallback_reason).toBeTruthy();
    }
    await expect(page.locator('.assistant-content').first()).toHaveCSS('font-size','16px');
    await expect(page.locator('.assistant-content').first()).toHaveCSS('line-height','26px');
    await expect(input).toHaveCSS('font-size','16px');
    await expect(page.getByText('LOCAL FALLBACK', {exact:true})).toHaveCount(0);
    await expect(page.getByText('FOREST INSIGHT', {exact:true})).toHaveCount(0);
    await page.getByRole('link', {name:'Scenarios',exact:true}).click();
    await page.getByRole('link', {name:'Monitor',exact:true}).click();
    await expect(page.getByRole('log')).toContainText('which zone?');
    await page.getByRole('button', {name:'New chat',exact:true}).click();
    await expect(page.getByRole('log')).not.toContainText('which zone?');
    expect(errors).toEqual([]);
  } finally {
    await api.post('/api/simulation/trigger', { data:{ zone:'zone_0_0',sound:'ambient',duration_seconds:10 } });
  }
});

test('long conversations scroll inside the panel and keep the composer visible at smaller widths', async ({ page }) => {
  await page.setViewportSize({width:1100,height:800});
  await page.route('**/api/assistant/status', (route) => route.fulfill({ json:{state:'unavailable',configured_model:'gemini-3.1-flash-lite',fallback_reason:'invalid_credentials'} }));
  await page.route('**/api/assistant/query', (route) => route.fulfill({ json:{answer:Array.from({length:45},(_,i)=>`Observation ${i+1}`).join('\n'),used_llm:false,mode:'local_data',model:'gemini-3.1-flash-lite',fallback_reason:'invalid_credentials'} }));
  await page.goto('/dashboard');
  const input = page.getByRole('textbox', {name:'Message Foresight AI'});
  await input.fill('show observations'); await input.press('Enter');
  await expect(page.locator('.assistant-message-ai')).toContainText('Observation 45');
  await input.scrollIntoViewIfNeeded();
  const dimensions = await page.getByRole('complementary', {name:'Forest assistant'}).evaluate((panel) => {
    const log=panel.querySelector('.assistant-messages'), composer=panel.querySelector('textarea');
    return {height:panel.getBoundingClientRect().height,composerBottom:composer.getBoundingClientRect().bottom,
      panelBottom:panel.getBoundingClientRect().bottom,overflow:log.scrollHeight>log.clientHeight,
      horizontalOverflow:log.scrollWidth>log.clientWidth};
  });
  expect(dimensions.height).toBeGreaterThanOrEqual(420);
  expect(dimensions.height).toBeLessThanOrEqual(704);
  expect(dimensions.composerBottom).toBeLessThanOrEqual(dimensions.panelBottom);
  expect(dimensions.overflow).toBe(true);
  expect(dimensions.horizontalOverflow).toBe(false);
});
