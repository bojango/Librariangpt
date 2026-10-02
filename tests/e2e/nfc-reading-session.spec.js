import { test, expect } from '@playwright/test';

const project = 'fbbpovieqfsjunmqtxvf';
const api = `https://${project}.supabase.co`;
const sessionId = '50000000-0000-0000-0000-000000000001';
const user = { id: '10000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test' };

async function mockApp(page, { authenticated = true, inaccessible = false, state = 'pending', pendingOnLaunch = false } = {}) {
  if (authenticated) {
    const accessToken = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture`;
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: `sb-${project}-auth-token`, value: { access_token: accessToken, refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user }
    });
  }
  let pageNumber = 273;
  let ownership = 'Owned';
  let bookmark = null;
  const saves = []; const bookmarkWrites = []; const statusWrites = [];
  const book = () => ({ id: 'book-1', title: 'NFC Test Book', authors: 'Test Author', overall_status: 'Currently Reading', ownership_status: ownership, current_page: pageNumber, total_pages: 364, metadata_status: 'complete' });
  await page.route(`${api}/**`, async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': '*' } });
    if (path === '/auth/v1/user') return json(user);
    if (path.endsWith('/reading_time_sessions')) {
      if (url.searchParams.get('select') === 'id') return json(pendingOnLaunch ? [{ id: sessionId }] : []);
      if (inaccessible) return json({ message: 'Row unavailable' }, 406);
      return json({ id: sessionId, book_id: 'book-1', start_page: 273, started_at: '2026-10-01T10:00:00Z', ended_at: '2026-10-01T10:20:34Z', progress_state: state });
    }
    if (path.endsWith('/finish_nfc_reading_session')) {
      const payload = request.postDataJSON(); saves.push(payload);
      if (!payload.p_skip) pageNumber = payload.p_page;
      return json({ status: payload.p_skip ? 'skipped' : 'submitted', book_id: 'book-1' });
    }
    if (path.endsWith('/nfc_bookmarks')) {
      if (request.method() === 'GET') return json(bookmark ? [bookmark] : []);
      const payload = request.postDataJSON(); bookmarkWrites.push(payload);
      bookmark = { ...bookmark, ...payload }; return json(null, 201);
    }
    if (path.endsWith('/set_library_status')) {
      const payload = request.postDataJSON(); statusWrites.push(payload);
      ownership = payload.p_ownership; return json(null);
    }
    if (path.endsWith('/v_library')) return json(url.searchParams.has('id') ? book() : [book()]);
    if (path.endsWith('/reader_profiles')) return json(null);
    if (path.includes('/rpc/')) return json(null);
    return json([]);
  });
  return { saves, bookmarkWrites, statusWrites };
}

test('NFC finish return retains persistent collection control and Profile configuration', async ({ page }) => {
  const { statusWrites } = await mockApp(page);
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  await page.getByRole('button', { name: 'Skip page entry' }).click();
  const control = page.locator('[data-collection-status]');
  await expect(control).toHaveCount(1);
  await expect(control).toContainText('Owned');
  await control.click();
  await page.getByRole('button', { name: 'On Order', exact: true }).click();
  await expect(control).toHaveCount(1);
  await expect(control).toContainText('On Order');
  expect(statusWrites).toEqual([{ p_book_id: 'book-1', p_status: 'Currently Reading', p_ownership: 'On Order', p_priority: null, p_source: 'frontend' }]);
  await expect(page.locator('.detail-header .status-currently-reading')).toBeVisible();
  await page.goto('/#/profile');
  await page.getByRole('button', { name: 'Configure bookmark' }).click();
  await expect(page.getByRole('button', { name: 'Create bookmark & token' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Book' })).toHaveValue('');
});

test('direct finish deep link uses numeric prefill/autofocus and saves through NFC RPC then returns to book', async ({ page }) => {
  const { saves } = await mockApp(page);
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  await expect(page.getByRole('heading', { name: 'NFC Test Book' })).toBeVisible();
  const input = page.getByRole('spinbutton', { name: 'Current page' });
  await expect(input).toHaveValue('273'); await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('inputmode', 'numeric');
  await expect(page.getByText('20 min 34 sec')).toBeVisible();
  await page.screenshot({ path: `test-results/nfc-finish-${test.info().project.name}.png` });
  await input.fill('280'); await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/book\/book-1$/);
  expect(saves).toEqual([{ p_session_id: sessionId, p_page: 280, p_skip: false }]);
});

test('PWA reload preserves finish route; skip resolves page entry', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  const { saves } = await mockApp(page);
  await page.goto(`/#/reading-session/${sessionId}/finish`); await page.reload();
  await expect(page.getByRole('spinbutton', { name: 'Current page' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip page entry' }).click();
  await expect(page).toHaveURL(/#\/book\/book-1$/);
  expect(saves[0].p_skip).toBe(true);
});

test('home launch redirects an authenticated pending NFC session to its finish screen', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await mockApp(page, { pendingOnLaunch: true });
  await page.goto('/#/home');
  await expect(page).toHaveURL(new RegExp(`#\\/reading-session\\/${sessionId}\\/finishimport { test, expect } from '@playwright/test';

const project = 'fbbpovieqfsjunmqtxvf';
const api = `https://${project}.supabase.co`;
const sessionId = '50000000-0000-0000-0000-000000000001';
const user = { id: '10000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test' };

async function mockApp(page, { authenticated = true, inaccessible = false, state = 'pending', pendingOnLaunch = false } = {}) {
  if (authenticated) {
    const accessToken = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture`;
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: `sb-${project}-auth-token`, value: { access_token: accessToken, refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user }
    });
  }
  let pageNumber = 273;
  let ownership = 'Owned';
  let bookmark = null;
  const saves = []; const bookmarkWrites = []; const statusWrites = [];
  const book = () => ({ id: 'book-1', title: 'NFC Test Book', authors: 'Test Author', overall_status: 'Currently Reading', ownership_status: ownership, current_page: pageNumber, total_pages: 364, metadata_status: 'complete' });
  await page.route(`${api}/**`, async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': '*' } });
    if (path === '/auth/v1/user') return json(user);
    if (path.endsWith('/reading_time_sessions')) {
      if (url.searchParams.get('select') === 'id') return json(pendingOnLaunch ? [{ id: sessionId }] : []);
      if (inaccessible) return json({ message: 'Row unavailable' }, 406);
      return json({ id: sessionId, book_id: 'book-1', start_page: 273, started_at: '2026-10-01T10:00:00Z', ended_at: '2026-10-01T10:20:34Z', progress_state: state });
    }
    if (path.endsWith('/finish_nfc_reading_session')) {
      const payload = request.postDataJSON(); saves.push(payload);
      if (!payload.p_skip) pageNumber = payload.p_page;
      return json({ status: payload.p_skip ? 'skipped' : 'submitted', book_id: 'book-1' });
    }
    if (path.endsWith('/nfc_bookmarks')) {
      if (request.method() === 'GET') return json(bookmark ? [bookmark] : []);
      const payload = request.postDataJSON(); bookmarkWrites.push(payload);
      bookmark = { ...bookmark, ...payload }; return json(null, 201);
    }
    if (path.endsWith('/set_library_status')) {
      const payload = request.postDataJSON(); statusWrites.push(payload);
      ownership = payload.p_ownership; return json(null);
    }
    if (path.endsWith('/v_library')) return json(url.searchParams.has('id') ? book() : [book()]);
    if (path.endsWith('/reader_profiles')) return json(null);
    if (path.includes('/rpc/')) return json(null);
    return json([]);
  });
  return { saves, bookmarkWrites, statusWrites };
}

test('NFC finish return retains persistent collection control and Profile configuration', async ({ page }) => {
  const { statusWrites } = await mockApp(page);
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  await page.getByRole('button', { name: 'Skip page entry' }).click();
  const control = page.locator('[data-collection-status]');
  await expect(control).toHaveCount(1);
  await expect(control).toContainText('Owned');
  await control.click();
  await page.getByRole('button', { name: 'On Order', exact: true }).click();
  await expect(control).toHaveCount(1);
  await expect(control).toContainText('On Order');
  expect(statusWrites).toEqual([{ p_book_id: 'book-1', p_status: 'Currently Reading', p_ownership: 'On Order', p_priority: null, p_source: 'frontend' }]);
  await expect(page.locator('.detail-header .status-currently-reading')).toBeVisible();
  await page.goto('/#/profile');
  await page.getByRole('button', { name: 'Configure bookmark' }).click();
  await expect(page.getByRole('button', { name: 'Create bookmark & token' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Book' })).toHaveValue('');
});

test('direct finish deep link uses numeric prefill/autofocus and saves through NFC RPC then returns to book', async ({ page }) => {
  const { saves } = await mockApp(page);
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  await expect(page.getByRole('heading', { name: 'NFC Test Book' })).toBeVisible();
  const input = page.getByRole('spinbutton', { name: 'Current page' });
  await expect(input).toHaveValue('273'); await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('inputmode', 'numeric');
  await expect(page.getByText('20 min 34 sec')).toBeVisible();
  await page.screenshot({ path: `test-results/nfc-finish-${test.info().project.name}.png` });
  await input.fill('280'); await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/#\/book\/book-1$/);
  expect(saves).toEqual([{ p_session_id: sessionId, p_page: 280, p_skip: false }]);
});

));
  await expect(page.getByRole('spinbutton', { name: 'Current page' })).toBeVisible();
});

test('pending NFC startup redirect does not override an explicit non-home route', async ({ page }) => {
  await mockApp(page, { pendingOnLaunch: true });
  await page.goto('/#/profile');
  await expect(page).toHaveURL(/#\/profile$/);
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
});

test('signed-out deep link requires login, UUID alone exposes no session', async ({ page }) => {
  await mockApp(page, { authenticated: false });
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  await expect(page.getByRole('spinbutton', { name: 'Current page' })).toHaveCount(0);
  await expect(page.locator('#auth-form')).toBeVisible();
  await expect(page).toHaveURL(/\/finish$/);
});

test('unavailable session cannot display page entry', async ({ page }) => {
  await mockApp(page, { inaccessible: true });
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  await expect(page.getByText('This reading session is unavailable. Sign in as its owner.')).toBeVisible();
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
});

test('Profile generates token once, stores only SHA-256, rotates and toggles without exposing stored secret', async ({ page }) => {
  const { bookmarkWrites } = await mockApp(page);
  await page.goto('/#/profile'); await page.getByRole('button', { name: 'Configure bookmark' }).click();
  await page.getByRole('button', { name: 'Create bookmark & token' }).click();
  const tokenBox = page.getByRole('textbox', { name: 'New bookmark token' });
  await expect(tokenBox).toBeVisible(); const first = await tokenBox.inputValue();
  expect(first).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
  expect(bookmarkWrites[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(bookmarkWrites)).not.toContain(first);
  expect(await page.evaluate(value => JSON.stringify(localStorage).includes(value), first)).toBe(false);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Configure bookmark' }).click();
  await expect(tokenBox).toHaveCount(0); await expect(page.getByText(/Token configured/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Enabled' }).uncheck();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect.poll(() => bookmarkWrites.length).toBe(2); expect(bookmarkWrites[1].enabled).toBe(false);
  expect(bookmarkWrites[1].token_hash).toBeUndefined();
  await page.getByRole('checkbox', { name: 'Enabled' }).check();
  await page.getByRole('button', { name: 'Rotate token' }).click();
  await expect(tokenBox).toBeVisible(); expect(await tokenBox.inputValue()).not.toBe(first);
  expect(bookmarkWrites[2].enabled).toBe(true);
});
