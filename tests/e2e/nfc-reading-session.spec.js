import { test, expect } from '@playwright/test';

const project = 'fbbpovieqfsjunmqtxvf';
const api = `https://${project}.supabase.co`;
const sessionId = '50000000-0000-0000-0000-000000000001';
const user = { id: '10000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test' };

async function mockApp(page, { authenticated = true, inaccessible = false, state = 'pending', pendingOnLaunch = false, activeOnLaunch = false, selectionOnLaunch = false } = {}) {
  if (authenticated) {
    const accessToken = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture`;
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: `sb-${project}-auth-token`, value: { access_token: accessToken, refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user }
    });
  }
  let pageNumber = 273;
  let ownership = 'Owned';
  let bookmark = null;
  const saves = []; const bookmarkWrites = []; const statusWrites = []; const controls = []; const lifecycleQueries = [];
  let destination = pendingOnLaunch ? 'reading-session-finish' : activeOnLaunch ? 'reading-session-active' : selectionOnLaunch ? 'reading-session-choose' : null;
  let endedAt = activeOnLaunch ? null : '2026-10-01T10:20:34Z';
  let startedAt = activeOnLaunch ? new Date(Date.now() - 1234000).toISOString() : '2026-10-01T10:00:00Z';
  let selectedBook = 'book-1', startPage = 273;
  const book = () => ({ id: 'book-1', title: 'NFC Test Book', authors: 'Test Author', overall_status: 'Currently Reading', ownership_status: ownership, current_page: pageNumber, total_pages: 364, metadata_status: 'complete' });
  const otherBook = () => ({ id: 'book-2', title: 'Next Main Read', authors: 'Other Author', overall_status: 'Owned - Unread', ownership_status: 'Owned', current_page: 12, total_pages: 200, metadata_status: 'complete' });
  await page.route(`${api}/**`, async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': '*' } });
    if (path === '/auth/v1/user') return json(user);
    if (path.endsWith('/nfc_session_destination')) { lifecycleQueries.push(request.method()); return json(destination ? { name: destination, sessionId } : null); }
    if (path.endsWith('/nfc_pending_starts')) return json({ id: sessionId, tapped_at: startedAt, reason: 'no_current_book' });
    if (path.endsWith('/control_nfc_session')) {
      const payload = request.postDataJSON(); controls.push(payload);
      if (payload.p_action === 'cancel') { destination = null; return json({ status: 'cancelled' }); }
      if (payload.p_action === 'change' || payload.p_action === 'select') { selectedBook = payload.p_book_id; startPage = selectedBook === 'book-2' ? 12 : pageNumber; }
      if (payload.p_action === 'end') { endedAt = new Date().toISOString(); destination = 'reading-session-finish'; }
      if (payload.p_action === 'restart' || payload.p_action === 'select') { startedAt = new Date().toISOString(); startPage = selectedBook === 'book-2' ? 12 : pageNumber; endedAt = null; destination = 'reading-session-active'; }
      return json({ status: endedAt ? 'awaiting_page' : 'started', session_id: sessionId, book_id: selectedBook, started_at: startedAt, ended_at: endedAt });
    }
    if (path.endsWith('/reading_time_sessions')) {
      if (url.searchParams.get('select') === 'id') return json(pendingOnLaunch ? [{ id: sessionId }] : []);
      if (inaccessible) return json({ message: 'Row unavailable' }, 406);
      return json({ id: sessionId, book_id: selectedBook, start_page: startPage, started_at: startedAt, ended_at: endedAt, progress_state: state });
    }
    if (path.endsWith('/finish_nfc_reading_session')) {
      const payload = request.postDataJSON(); saves.push(payload);
      if (!payload.p_skip) pageNumber = payload.p_page;
      destination = null;
      return json({ status: payload.p_skip ? 'skipped' : 'submitted', book_id: selectedBook });
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
    if (path.endsWith('/v_library')) return json(url.searchParams.has('id') ? url.searchParams.get('id') === 'eq.book-2' ? otherBook() : book() : [book(), otherBook()]);
    if (path.endsWith('/reader_profiles')) return json(null);
    if (path.includes('/rpc/')) return json(null);
    return json([]);
  });
  return { saves, bookmarkWrites, statusWrites, controls, lifecycleQueries, setDestination: value => { destination = value; if (value === 'reading-session-finish') endedAt = new Date().toISOString(); } };
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
  await expect(page.getByText('00:20:34')).toBeVisible();
  await page.screenshot({ path: `test-results/nfc-finish-${test.info().project.name}.png` });
  await input.fill('280'); await page.getByRole('button', { name: 'Save session', exact: true }).click();
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
  await expect(page).toHaveURL(new RegExp(`#\\/reading-session\\/${sessionId}\\/finish$`));
  await expect(page.getByRole('spinbutton', { name: 'Current page' })).toBeVisible();
});

test('pending NFC startup redirect does not override an explicit non-home route', async ({ page }) => {
  await mockApp(page, { pendingOnLaunch: true });
  await page.goto('/#/profile');
  await expect(page).toHaveURL(/#\/profile$/);
  await expect(page.getByRole('heading', { name: 'Reading Record' })).toBeVisible();
});

test('foregrounding an already-running home PWA redirects a pending NFC session', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await mockApp(page, { pendingOnLaunch: true });
  await page.goto('/#/profile');
  await page.evaluate(() => { location.hash = '#/home'; });
  await expect(page).toHaveURL(/#\/home$/);
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); });
  await expect(page).toHaveURL(new RegExp(`#\\/reading-session\\/${sessionId}\\/finish$`));
  await expect(page.getByRole('spinbutton', { name: 'Current page' })).toBeVisible();
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

test('cold root launch surfaces running session, live HH:MM:SS timer and app End', async ({ page }) => {
  const { controls } = await mockApp(page, { activeOnLaunch: true });
  await page.goto('/');
  await expect(page).toHaveURL(/\/active$/);
  await expect(page.getByRole('timer')).toHaveText(/\d{2}:\d{2}:\d{2}/);
  const first = await page.getByRole('timer').textContent();
  await expect(page.getByRole('timer')).not.toHaveText(first);
  await expect(page.getByText('Test Author', { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/nfc-active-${test.info().project.name}.png` });
  await page.getByRole('button', { name: 'End session', exact: true }).click();
  await expect(page).toHaveURL(/\/finish$/);
  await expect(page.getByRole('button', { name: 'Save session' })).toBeVisible();
  expect(controls[0]).toEqual({ p_id: sessionId, p_action: 'end', p_book_id: null });
});

test('warm foreground session checks deduplicate focus and visibility, and reconcile NFC End', async ({ page }) => {
  const mock = await mockApp(page, { activeOnLaunch: true });
  await page.goto('/#/profile');
  await page.evaluate(() => { location.hash = '#/home'; });
  await expect(page).toHaveURL(/#\/home$/);
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await expect(page).toHaveURL(/\/active$/);
  expect(mock.lifecycleQueries.length).toBe(1);
  // Wait until the foreground event coalescing window has passed, then simulate a later NFC stop.
  await page.waitForTimeout(800);
  mock.setDestination('reading-session-finish');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(/\/finish$/);
});

test('running session leaves explicit Profile and book deep links intact', async ({ page }) => {
  const { lifecycleQueries } = await mockApp(page, { activeOnLaunch: true });
  for (const hash of ['profile', 'book/book-1']) {
    await page.goto(`/#/${hash}`);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page).toHaveURL(new RegExp(`#/${hash}$`));
  }
  expect(lifecycleQueries.length).toBe(0);
});

test('Restart requires confirmation, keeps session and resets visible timer', async ({ page }) => {
  const { controls } = await mockApp(page, { activeOnLaunch: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Restart session', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Restart session?' })).toBeVisible();
  expect(controls.length).toBe(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(controls.length).toBe(0);
  await page.getByRole('button', { name: 'Restart session', exact: true }).click();
  await page.locator('[data-confirm-restart]').click();
  await expect(page.getByRole('timer')).toHaveText('00:00:00');
  expect(controls[0].p_action).toBe('restart'); expect(controls[0].p_id).toBe(sessionId);
});

test('pending start cold launch offers search, startable book selection and Active screen', async ({ page }) => {
  const { controls } = await mockApp(page, { selectionOnLaunch: true });
  await page.goto('/');
  await expect(page).toHaveURL(/\/choose$/);
  await expect(page.getByRole('heading', { name: 'Choose book for reading session' })).toBeVisible();
  const options = page.locator('[data-session-book]'); await expect(options.first()).toContainText('NFC Test Book');
  await page.getByRole('searchbox', { name: 'Search your library' }).fill('Next');
  await expect(options.first()).toBeHidden();
  await page.getByRole('button', { name: /Next Main Read/ }).click();
  await expect(page).toHaveURL(/\/active$/);
  await expect(page.getByRole('heading', { name: 'Next Main Read' })).toBeVisible();
  expect(controls[0]).toEqual({ p_id: sessionId, p_action: 'select', p_book_id: 'book-2' });
});

test('pending start cancels safely and warm resume surfaces selection', async ({ page }) => {
  const { controls } = await mockApp(page, { selectionOnLaunch: true });
  await page.goto('/#/profile');
  await page.evaluate(() => { location.hash = '#/home'; });
  await expect(page).toHaveURL(/#\/home$/);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(/\/choose$/);
  await page.getByRole('button', { name: 'Cancel pending start' }).click();
  await expect(page).toHaveURL(/#\/home$/); expect(controls[0].p_action).toBe('cancel');
});

test('Change running session updates book, author and starting page without changing route identity', async ({ page }) => {
  const { controls } = await mockApp(page, { activeOnLaunch: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByRole('button', { name: /Next Main Read/ }).click();
  await expect(page.getByRole('heading', { name: 'Next Main Read' })).toBeVisible();
  await expect(page.getByText('Other Author', { exact: true })).toBeVisible();
  await expect(page.locator('.session-facts')).toContainText('12');
  await expect(page).toHaveURL(new RegExp(`${sessionId}/active$`));
  expect(controls[0].p_action).toBe('change');
});

test('finish displays local times, start page, live stats, invalid pages and corrected book prefill', async ({ page }) => {
  const { controls, saves } = await mockApp(page);
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  await expect(page.getByText('00:20:34')).toBeVisible();
  await expect(page.locator('.session-facts').first()).toContainText('273');
  const localTimes = await page.evaluate(() => ['2026-10-01T10:00:00Z','2026-10-01T10:20:34Z'].map(s => new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })));
  for (const time of localTimes) await expect(page.locator('.session-facts').first()).toContainText(time);
  const input = page.getByRole('spinbutton', { name: 'Current page' });
  await input.fill('280'); await expect(page.locator('[data-session-pages]')).toHaveText('7');
  await expect(page.locator('[data-session-pace]')).toHaveText('20.4 pages/hour');
  for (const value of ['272', '365', '274.5', '']) {
    await input.fill(value); await expect(page.locator('[data-session-pace]')).toHaveText('—');
    await page.getByRole('button', { name: 'Save session' }).click(); expect(saves.length).toBe(0);
  }
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByRole('button', { name: /Next Main Read/ }).click();
  await expect(input).toHaveValue('12');
  await input.fill('47'); await expect(page.locator('[data-session-pages]')).toHaveText('35');
  await expect(page.locator('[data-session-pace]')).toHaveText('102.1 pages/hour');
  await page.getByRole('button', { name: 'Save session' }).click();
  await expect(page).toHaveURL(/#\/book\/book-2$/);
  expect(controls[0].p_book_id).toBe('book-2'); expect(saves[0].p_page).toBe(47);
});

for (const state of ['submitted','skipped']) test(`${state} finish is read-only`, async ({ page }) => {
  await mockApp(page, { state }); await page.goto(`/#/reading-session/${sessionId}/finish`);
  await expect(page.getByText('This session is already saved or skipped.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change', exact: true })).toHaveCount(0);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
});

test('no unresolved NFC state opens normal Home', async ({ page }) => {
  const { lifecycleQueries } = await mockApp(page); await page.goto('/');
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('[data-session-timer]')).toHaveCount(0);
  expect(lifecycleQueries.length).toBe(1);
});
