import { test, expect } from '@playwright/test';

const project = 'fbbpovieqfsjunmqtxvf';
const api = `https://${project}.supabase.co`;

function jwt(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${payload}.fixture-signature`;
}

async function mockApplication(page, { bookOverrides = {}, bookAccolades = [], editions = [], adminRpcError = null, adminRpcDelayMs = 0 } = {}) {
  const user = { id: '8bfc753c-cb6c-4b75-bd4a-2d5986ed8319', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test' };
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: `sb-${project}-auth-token`,
    value: { access_token: jwt(user.id), refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  });
  let revision = 0;
  let adminPayload = null;
  let adminCalls = 0;
  let recognitionPayload = null;
  const book = () => ({
    id: 'a75f5ad6-fac6-4f25-bd28-f4ed926f4327', title: 'The Unfinished Harauld Hughes', authors: 'Fixture Author',
    overall_status: 'Currently Reading', ownership_status: 'Owned', current_page: 40 + revision,
    total_pages: 200, progress_percent: 20, cover_url: '/diagnostic-cover.svg', primary_genre: 'Fiction',
    synopsis: 'Present', display_edition_id: '8c655279-dab4-41c8-a963-cdb89a9b11e2',
    ...bookOverrides
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
    if (path.includes('/rest/v1/book_accolades')) {
      if (route.request().method() === 'PATCH') recognitionPayload = route.request().postDataJSON();
      return json(bookAccolades);
    }
    if (path.includes('/rest/v1/accolades')) return json(bookAccolades.map(row => row.accolade));
    if (path.includes('/rest/v1/editions')) return json(editions);
    if (path.includes('/rest/v1/rpc/admin_edit_book')) {
      adminCalls += 1;
      adminPayload = route.request().postDataJSON();
      if (adminRpcDelayMs) await new Promise(resolve => setTimeout(resolve, adminRpcDelayMs));
      if (adminRpcError) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: adminRpcError, code: 'P0001' }), headers: { 'access-control-allow-origin': '*' } });
      return json({ book: { overall_status: adminPayload.p_library.overall_status || 'Owned - Unread', ownership_status: adminPayload.p_library.ownership_status } });
    }
    if (path.includes('/rest/v1/v_library')) {
      const singular = /vnd\.pgrst\.object/i.test(route.request().headers().accept || '');
      return json(singular ? book() : [book()]);
    }
    return json([]);
  });
  return { bump: () => { revision += 1; }, adminPayload: () => adminPayload, adminCalls: () => adminCalls, recognitionPayload: () => recognitionPayload };
}

async function openBookSettings(page, url = '/#/library') {
  await page.goto(url);
  await page.locator('[data-open-book]').first().click();
  await page.getByText('Book & edition details', { exact: true }).click();
  await page.locator('[data-book-admin]').click();
  await expect(page.locator('#book-admin-form')).toBeVisible();
}

const blackHolesEditions = [
  { id: 'bd72ab83-5825-423e-94d8-4c83dbe6bbcc', book_id: 'a75f5ad6-fac6-4f25-bd28-f4ed926f4327', isbn13: '9780008390648', publication_year: 2023, page_count: 288, owned: false, is_reference: false },
  { id: 'bdd178d6-6d05-4c35-a23a-fef7b8caa40d', book_id: 'a75f5ad6-fac6-4f25-bd28-f4ed926f4327', isbn13: '9780008390655', publication_year: 2022, owned: false, is_reference: false },
  { id: 'a850780c-9e80-4f34-8a1b-0a0b416936ee', book_id: 'a75f5ad6-fac6-4f25-bd28-f4ed926f4327', isbn13: '9780008597061', publication_year: 2022, owned: false, is_reference: false },
  { id: '8fb79858-e4ce-4ef2-9ccd-2574be30bd83', book_id: 'a75f5ad6-fac6-4f25-bd28-f4ed926f4327', isbn13: '9780008390624', publication_year: 2022, owned: false, is_reference: false },
  { id: '900dff66-8b23-4e6d-abcc-4e27ce8dd688', book_id: 'a75f5ad6-fac6-4f25-bd28-f4ed926f4327', isbn13: '9780733340444', publication_year: 2022, page_count: 288, owned: false, is_reference: false },
  { id: '97709152-09b6-4c70-9977-683d063eb6d4', book_id: 'a75f5ad6-fac6-4f25-bd28-f4ed926f4327', isbn13: '9780008350758', publication_year: 2022, page_count: 320, owned: false, is_reference: true }
];

test('Test Mode off creates no API, database, event stream or indicator', async ({ page }) => {
  await mockApplication(page);
  await page.goto('/#/home');
  await expect(page.locator('[data-current-card]')).toBeVisible();
  expect(await page.evaluate(() => '__RR_TEST__' in window)).toBe(false);
  expect(await page.locator('[data-test-indicator]').count()).toBe(0);
  const databases = await page.evaluate(async () => indexedDB.databases ? (await indexedDB.databases()).map(database => database.name) : []);
  expect(databases).not.toContain('reading-room-diagnostics-v1');
});

test('Appearance editor saves typed slider values cleanly without rerendering the route', async ({ page }) => {
  await mockApplication(page);
  await page.goto('/#/home');
  await expect(page.locator('[data-current-card]')).toBeVisible();
  await page.locator('[data-menu]').click();
  await page.getByRole('button', { name: 'Customise appearance' }).click();
  const editor = page.getByRole('dialog', { name: 'Customise interface' });
  await expect(editor).toBeVisible();
  for (const name of ['Preset', 'Typography', 'Colours', 'Geometry & density', 'Navigation', 'Labels & titles']) {
    await expect(editor.getByRole('tab', { name })).toBeVisible();
  }
  await editor.getByRole('tab', { name: 'Typography' }).click();
  const headingAdjust = editor.locator('input[data-pref="headingAdjust"]');
  const headingOutput = editor.locator('output[data-pref-output="headingAdjust"]');
  await expect(headingOutput).toHaveText('0px · Default');
  const canonicalHeadingSize = await page.locator('[data-current-card] .hero-copy h1').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  await page.evaluate(() => {
    window.__appearanceRouteMutations = 0;
    new MutationObserver(records => { window.__appearanceRouteMutations += records.length; }).observe(document.querySelector('#app'), { childList: true, subtree: true });
  });
  await headingAdjust.evaluate(input => { input.value = '3'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await expect(headingOutput).toHaveText('3px');
  const adjustedHeadingSize = await page.locator('[data-current-card] .hero-copy h1').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
  expect(adjustedHeadingSize).toBeCloseTo(canonicalHeadingSize + 3, 1);
  await expect(editor.locator('[data-appearance-dirty]')).toHaveText('Unsaved changes');
  expect(await page.evaluate(() => window.__appearanceRouteMutations)).toBe(0);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#toast')).toHaveText('Appearance saved.');
  await expect(editor.locator('[data-appearance-dirty]')).toHaveText('');
  let closeDialogCount = 0;
  page.on('dialog', dialog => { closeDialogCount += 1; dialog.dismiss(); });
  await editor.getByRole('button', { name: 'Close appearance editor' }).click();
  await expect(editor).toHaveCount(0);
  expect(closeDialogCount).toBe(0);
  await page.locator('[data-menu]').click();
  await page.getByRole('button', { name: 'Customise appearance' }).click();
  await editor.getByRole('tab', { name: 'Typography' }).click();
  await expect(editor.locator('input[data-pref="headingAdjust"]')).toHaveValue('3');
  await headingAdjust.evaluate(input => { input.value = '4'; input.dispatchEvent(new Event('input', { bubbles: true })); });
  await editor.getByRole('button', { name: 'Close appearance editor' }).click();
  await expect.poll(() => closeDialogCount).toBe(1);
  await expect(editor).toBeVisible();
});

test('Book Settings saves ownership, keeps recognition forms independent, and lets the RPC infer Owned - Unread', async ({ page }) => {
  const fixture = await mockApplication(page, {
    bookOverrides: { overall_status: 'Wishlist', ownership_status: 'On Order' },
    bookAccolades: [{
      id: 'claim-1', accolade_id: 'award-1', year: 2025, result: 'Winner', category: null,
      source_url: 'https://example.test/award', source_name: 'Fixture source', verified: true, sort_order: 1,
      accolade: { id: 'award-1', name: 'Fixture Award', short_name: 'FA', type: 'Award' }
    }]
  });
  await page.goto('/#/library');
  await page.locator('[data-open-book]').first().click();
  await page.getByText('Book & edition details', { exact: true }).click();
  await expect(page.locator('[data-book-admin]')).toBeVisible();
  await page.locator('[data-book-admin]').click();
  await expect(page.locator('#book-admin-form')).toBeVisible();
  await expect(page.locator('#book-admin-form form')).toHaveCount(0);
  await expect(page.locator('[data-accolade-row]')).toHaveCount(1);
  await expect(page.locator('[data-accolade-add]')).toHaveCount(1);

  await page.getByText('Awards & recognition', { exact: true }).click();
  await page.locator('[data-accolade-row] input[name="year"]').fill('2026');
  await page.locator('[data-accolade-row]').getByRole('button', { name: 'Save recognition' }).click();
  await expect.poll(() => fixture.recognitionPayload()?.year).toBe(2026);
  await expect(page.locator('#book-admin-form')).toBeVisible();

  await page.locator('#book-admin-form select[name="ownership_status"]').selectOption('Owned');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => fixture.adminPayload()?.p_library?.ownership_status).toBe('Owned');
  expect(fixture.adminPayload().p_library).not.toHaveProperty('overall_status');
  await expect(page.locator('#book-admin-form')).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText('Book details saved.');
});

test('multi-edition Book Settings directly saves Wishlist / On Order and records the save path', async ({ page }) => {
  const fixture = await mockApplication(page, {
    bookOverrides: { title: 'Black Holes', overall_status: 'Wishlist', ownership_status: 'Not Owned',
      display_edition_id: '97709152-09b6-4c70-9977-683d063eb6d4', original_publication_year: 2022 },
    editions: blackHolesEditions
  });
  await openBookSettings(page, '/?test=1#/library');
  const form = page.locator('#book-admin-form');
  const button = page.locator('[data-book-admin-save]');
  await expect(page.locator('#admin-edition-select option')).toHaveCount(6);
  expect(await button.evaluate(node => node.form)).toBeNull();
  expect(await form.evaluate(node => node.checkValidity())).toBe(true);
  await form.locator('select[name="ownership_status"]').selectOption('On Order');
  await button.click();
  await expect.poll(() => fixture.adminCalls()).toBe(1);
  expect(fixture.adminPayload().p_library).toMatchObject({ overall_status: 'Wishlist', ownership_status: 'On Order' });
  await expect(form).toHaveCount(0);
  await expect(page.locator('#toast')).toHaveText('Book details saved.');
  const events = await page.evaluate(async () => (await window.__RR_TEST__.events()).filter(event => event.type.startsWith('book_admin_')));
  expect(events.map(event => event.type)).toEqual(['book_admin_opened', 'book_admin_save_tapped', 'book_admin_save_started', 'book_admin_rpc_started', 'book_admin_rpc_succeeded']);
  expect(events.at(-1).payload).toMatchObject({ overall_status_after: 'Wishlist', ownership_status_after: 'On Order' });
});

test('form submission uses the same save path without a second RPC', async ({ page }) => {
  const fixture = await mockApplication(page, { bookOverrides: { overall_status: 'Wishlist', ownership_status: 'Not Owned' } });
  await openBookSettings(page);
  await page.locator('#book-admin-form select[name="ownership_status"]').selectOption('On Order');
  await page.locator('#book-admin-form').evaluate(form => form.requestSubmit());
  await expect.poll(() => fixture.adminCalls()).toBe(1);
  await expect(page.locator('#book-admin-form')).toHaveCount(0);
  expect(fixture.adminPayload().p_library).toMatchObject({ overall_status: 'Wishlist', ownership_status: 'On Order' });
});

test('invalid field in a closed section opens it, explains the error, and prevents RPC', async ({ page }) => {
  const fixture = await mockApplication(page);
  await openBookSettings(page, '/?test=1#/library');
  const section = page.locator('#book-admin-form details').filter({ has: page.locator('[name="book_original_publication_year"]') });
  await expect(section).not.toHaveAttribute('open');
  await page.locator('[name="book_original_publication_year"]').evaluate(input => { input.value = '3001'; });
  await page.locator('[data-book-admin-save]').click();
  await expect(section).toHaveAttribute('open', '');
  await expect(page.locator('[data-book-admin-feedback]')).toBeVisible();
  await expect(page.locator('[data-book-admin-feedback]')).toContainText('Original publication year');
  await expect(page.locator('#book-admin-form')).toBeVisible();
  expect(fixture.adminCalls()).toBe(0);
  const events = await page.evaluate(async () => (await window.__RR_TEST__.events()).filter(event => event.type.startsWith('book_admin_')));
  expect(events.map(event => event.type)).toEqual(['book_admin_opened', 'book_admin_save_tapped', 'book_admin_validation_failed']);
  expect(events.at(-1).payload.invalid_control_name).toBe('book_original_publication_year');
});

test('failed save restores the button and displays the RPC error', async ({ page }) => {
  const fixture = await mockApplication(page, { adminRpcError: 'Fixture RPC failure', adminRpcDelayMs: 250 });
  await openBookSettings(page);
  const button = page.locator('[data-book-admin-save]');
  await button.click();
  await expect(button).toBeDisabled();
  await expect(button).toHaveText('Saving…');
  await page.locator('#book-admin-form').evaluate(form => form.requestSubmit());
  await expect(button).toBeEnabled();
  await expect(button).toHaveText('Save changes');
  await expect(page.locator('[data-book-admin-feedback]')).toContainText('Fixture RPC failure');
  await expect(page.locator('#toast')).toHaveText('Fixture RPC failure');
  await expect(page.locator('#book-admin-form')).toBeVisible();
  expect(fixture.adminCalls()).toBe(1);
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
