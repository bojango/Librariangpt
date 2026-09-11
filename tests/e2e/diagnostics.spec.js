import { test, expect } from '@playwright/test';

const project = 'fbbpovieqfsjunmqtxvf';
const api = `https://${project}.supabase.co`;

function jwt(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${payload}.fixture-signature`;
}

async function mockApplication(page) {
  const user = { id: '8bfc753c-cb6c-4b75-bd4a-2d5986ed8319', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test' };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: `sb-${project}-auth-token`,
    value: { access_token: jwt(user.id), refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  });
  let revision = 0;
  const book = () => ({
    id: 'a75f5ad6-fac6-4f25-bd28-f4ed926f4327', title: 'The Unfinished Harauld Hughes', authors: 'Fixture Author',
    overall_status: 'Currently Reading', ownership_status: 'Owned', current_page: 40 + revision,
    total_pages: 200, progress_percent: 20, cover_url: '/diagnostic-cover.svg', primary_genre: 'Fiction',
    synopsis: 'Present', display_edition_id: '8c655279-dab4-41c8-a963-cdb89a9b11e2'
  });
  await page.route('**/diagnostic-cover.svg', route => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#735"/></svg>' }));
  await page.route(`${api}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': '*' } });
    if (path === '/auth/v1/user') return json(user);
    if (path.includes('/rest/v1/v_library_chapters')) return json([]);
    if (path.includes('/rest/v1/v_ai_recommendations')) return json([]);
    if (path.includes('/rest/v1/v_up_next')) return json([]);
    if (path.includes('/rest/v1/recommendations')) return json([]);
    if (path.includes('/rest/v1/v_library')) return json([book()]);
    return json([]);
  });
  return { bump: () => { revision += 1; } };
}

test('Test Mode off creates no API, database, event stream or indicator', async ({ page }) => {
  await mockApplication(page);
  await page.goto('/#/home');
  await expect(page.locator('[data-current-card]')).toBeVisible();
  expect(await page.evaluate(() => '__RR_TEST__' in window)).toBe(false);
  expect(await page.locator('[data-test-indicator]').count()).toBe(0);
  const databases = await page.evaluate(async () => indexedDB.databases ? (await indexedDB.databases()).map(database => database.name) : []);
  expect(databases).not.toContain('reading-room-diagnostics-v1');
});

test('Test Mode records ordered route, paint, title, cover, scroll and lifecycle evidence', async ({ page }) => {
  await mockApplication(page);
  await page.goto('/?test=1#/home');
  await expect(page.locator('[data-current-card]')).toBeVisible();
  await expect(page.locator('[data-test-indicator]')).toHaveText('TEST');
  await expect.poll(() => page.evaluate(async () => (await window.__RR_TEST__.events()).length)).toBeGreaterThan(8);

  const initial = await page.evaluate(async () => await window.__RR_TEST__.events());
  expect(initial.map(event => event.sequence)).toEqual(initial.map((_, index) => index + 1));
  expect(initial.every(event => event.timestamp_wall && event.timestamp_monotonic != null)).toBe(true);
  expect(initial.some(event => event.type === 'route_render_complete' && event.route === 'home')).toBe(true);
  expect(initial.some(event => event.type === 'paint_complete' && event.payload.replacement)).toBe(true);
  const title = initial.find(event => event.type === 'current_title_state');
  expect(title.payload.semantic_variant).toBe('compact');
  expect(title.payload.computed_font_size).toMatch(/px$/);
  expect(initial.some(event => event.type === 'cover_activation_summary')).toBe(true);

  await page.evaluate(async () => window.__RR_TEST__.mark('title_wrong'));
  expect(await page.evaluate(async () => (await window.__RR_TEST__.events()).at(-1))).toMatchObject({ type: 'issue_marker', payload: { category: 'title_wrong' } });
  await page.locator('[data-menu]').click();
  await expect(page.locator('.diagnostics-summary')).toContainText('Code');
  await page.locator('[data-diag-mark]').click();
  await page.locator('[data-diag-category="covers_flashed"]').click();
  await expect.poll(() => page.evaluate(async () => (await window.__RR_TEST__.events()).filter(event => event.type === 'issue_marker').length)).toBe(2);
  await page.locator('[data-side-close]').click();

  await page.evaluate(() => { for (let index = 0; index < 30; index += 1) window.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(80);
  const checkpoints = await page.evaluate(async () => (await window.__RR_TEST__.events()).filter(event => event.type === 'scroll_checkpoint').length);
  expect(checkpoints).toBeLessThan(5);

  await page.evaluate(() => {
    let visibility = 'hidden';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    document.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    const hide = new Event('pagehide'); Object.defineProperty(hide, 'persisted', { value: false }); window.dispatchEvent(hide);
    const show = new Event('pageshow'); Object.defineProperty(show, 'persisted', { value: true }); window.dispatchEvent(show);
  });
  await page.locator('[data-current-card]').click();
  await expect(page).toHaveURL(/#\/book\//);
  const types = await page.evaluate(async () => (await window.__RR_TEST__.events()).map(event => event.type));
  expect(types).toEqual(expect.arrayContaining(['visibility_hidden', 'visibility_visible', 'pagehide', 'pageshow', 'programmatic_scroll_requested']));
});

test('same-route refresh distinguishes reused covers without losing the loaded node', async ({ page }) => {
  const fixture = await mockApplication(page);
  await page.goto('/?test=1#/home');
  const image = page.locator('[data-current-card] .cover-image');
  await expect(image).toHaveJSProperty('complete', true);
  await image.evaluate(node => { node.dataset.diagnosticIdentity = 'same-node'; });
  fixture.bump();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('reading-room:refresh', { detail: { scope: 'library' } })));
  await expect.poll(() => page.evaluate(async () => (await window.__RR_TEST__.events()).filter(event => event.type === 'refresh_complete').length)).toBeGreaterThan(0);
  await expect(image).toHaveAttribute('data-diagnostic-identity', 'same-node');
  const events = await page.evaluate(async () => await window.__RR_TEST__.events());
  expect(events.some(event => event.type === 'cover_node_reused')).toBe(true);
  const paint = events.filter(event => event.type === 'paint_complete').at(-1);
  expect(paint.payload.covers_reused).toBeGreaterThan(0);
});
