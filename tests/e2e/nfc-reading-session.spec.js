import { test, expect } from '@playwright/test';

import { mockApp, sessionId, api } from '../helpers/nfc-app.js';

test('book sticker cold root consumes once, loads normal book detail and does not reopen on Home reload', async ({ page }) => {
  const mock = await mockApp(page, { bookOnLaunch: 'book-2' });
  await page.goto('/');
  await expect(page).toHaveURL(/#\/book\/book-2$/);
  await expect(page.getByRole('heading', { name: 'Next Main Read' })).toBeVisible();
  expect(mock.consumedBooks).toEqual(['book-2']);
  await page.goto('/#/home'); await page.reload();
  await expect(page).toHaveURL(/#\/home$/);
  expect(mock.consumedBooks).toEqual(['book-2']);
  expect(mock.saves).toEqual([]); expect(mock.controls).toEqual([]); expect(mock.statusWrites).toEqual([]);
});

test('warm Home coalesces focus and visibility into one book destination retrieval', async ({ page }) => {
  const mock = await mockApp(page);
  await page.goto('/#/profile');
  await page.evaluate(() => { location.hash = '#/home'; });
  await expect(page.locator('#app')).toHaveAttribute('data-route-view','home');
  mock.setBook('book-2');
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await expect(page).toHaveURL(/#\/book\/book-2$/);
  expect(mock.lifecycleQueries).toHaveLength(1); expect(mock.consumedBooks).toEqual(['book-2']);
});

for (const hash of ['profile','book/book-1']) test(`book sticker leaves explicit ${hash} intact until Home lifecycle`, async ({ page }) => {
  const mock = await mockApp(page, { bookOnLaunch: 'book-2' });
  await page.goto(`/#/${hash}`);
  await expect(page.locator('#app')).toHaveAttribute('data-route-view',hash.split('/')[0]);
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await expect(page).toHaveURL(new RegExp(`#/${hash}$`));
  expect(mock.lifecycleQueries).toHaveLength(0); expect(mock.pendingBook()).toBe('book-2');
  await page.evaluate(() => { location.hash = '#/home'; });
  await expect(page.locator('#app')).toHaveAttribute('data-route-view','home');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page).toHaveURL(/#\/book\/book-2$/);
});

for (const [option, suffix] of [['pendingOnLaunch','finish'],['activeOnLaunch','active'],['selectionOnLaunch','choose']]) test(`${suffix} priority preserves sticker until next eligible Home check`, async ({ page }) => {
  const mock = await mockApp(page, { [option]: true, bookOnLaunch: 'book-2' });
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp(`/${suffix}$`));
  expect(mock.pendingBook()).toBe('book-2'); expect(mock.consumedBooks).toEqual([]);
  mock.setDestination(null);
  // Active/Choose resume must not consume even after the higher state disappears.
  await page.waitForTimeout(800);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(mock.pendingBook()).toBe('book-2');
  await page.goto('/#/home');
  await page.reload();
  await expect(page).toHaveURL(/#\/book\/book-2$/);
  expect(mock.consumedBooks).toEqual(['book-2']);
});

test('Copy NFC book ID lives in collapsed metadata and copies exact canonical UUID with feedback', async ({ page }) => {
  const canonicalId = '20000000-0000-0000-0000-000000000001';
  await mockApp(page);
  // Give the first fixture a canonical UUID for this clipboard test.
  await page.route(`${api}/rest/v1/v_library*`, route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(
    route.request().url().includes('id=') ? { id: canonicalId,title: 'Clipboard book',authors:'Fixture',overall_status:'Wishlist',metadata_status:'complete' }
      : [{ id: canonicalId,title:'Clipboard book',authors:'Fixture',overall_status:'Wishlist',metadata_status:'complete' }]
  ) }));
  await page.addInitScript(() => Object.defineProperty(navigator,'clipboard',{ value: { writeText: async value => { window.copiedBookId=value; } } }));
  await page.goto(`/#/book/${canonicalId}`);
  const copy = page.getByRole('button', { name: 'Copy NFC book ID' });
  await expect(copy).toBeHidden();
  await page.getByText('Book & edition details', { exact: true }).click();
  await copy.click();
  await expect.poll(() => page.evaluate(() => window.copiedBookId)).toBe(canonicalId);
  await expect(page.getByText('NFC book ID copied.',{ exact:true })).toBeVisible();
});

test('NFC finish return retains persistent collection control and menu configuration', async ({ page }) => {
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
  await page.locator('[data-menu]').click(); await page.locator('.nfc-menu-section summary').click();
  await page.getByRole('button', { name: 'Configure bookmark' }).click();
  await expect(page.getByRole('button', { name: 'Create bookmark & token' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Book' })).toHaveValue('');
});

test('direct finish deep link uses numeric prefill, deliberate focus and saves through NFC RPC then returns to book', async ({ page }) => {
  const { saves } = await mockApp(page);
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  await expect(page.getByRole('heading', { name: 'NFC Test Book' })).toBeVisible();
  const input = page.getByRole('spinbutton', { name: 'Current page' });
  await expect(input).toHaveValue('273'); await expect(input).not.toBeFocused();
  await input.click(); await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('inputmode', 'numeric');
  await expect(page.getByText('00:20:34')).toBeVisible();
  await page.screenshot({ path: `test-results/nfc-finish-${test.info().project.name}.png` });
  await input.fill('280'); await page.getByRole('button', { name: 'Save session', exact: true }).click();
  await expect(page).toHaveURL(/#\/book\/book-1$/);
  expect(saves).toEqual([{ p_session_id: sessionId, p_page: 280, p_skip: false }]);
});

test('finish session type defaults to Reading and can mark a skipped QA session as Test', async ({ page }) => {
  const { kinds, saves } = await mockApp(page);
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  const kind = page.getByRole('combobox', { name: 'Session type' });
  await expect(kind).toHaveValue('reading');
  await kind.selectOption('test');
  await page.getByRole('button', { name: 'Skip page entry' }).click();
  await expect(page).toHaveURL(/#\/book\/book-1$/);
  expect(kinds).toEqual([{ p_session_id: sessionId, p_session_kind: 'test' }]);
  expect(saves[0].p_skip).toBe(true);
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
  await expect(page.getByRole('tab', { name: 'Feed', exact: true })).toHaveAttribute('aria-selected','true');
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

test('menu NFC settings generate token once, store only SHA-256, rotate and toggle without exposing stored secret', async ({ page }) => {
  const { bookmarkWrites } = await mockApp(page);
  await page.goto('/#/profile');
  await page.locator('[data-menu]').click(); await page.locator('.nfc-menu-section summary').click();
  await page.getByRole('button', { name: 'Configure bookmark' }).click();
  await page.getByRole('button', { name: 'Create bookmark & token' }).click();
  const tokenBox = page.getByRole('textbox', { name: 'New bookmark token' });
  await expect(tokenBox).toBeVisible(); const first = await tokenBox.inputValue();
  expect(first).toMatch(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/);
  expect(bookmarkWrites[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(JSON.stringify(bookmarkWrites)).not.toContain(first);
  expect(await page.evaluate(value => JSON.stringify(localStorage).includes(value), first)).toBe(false);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('[data-menu]').click(); await page.locator('.nfc-menu-section summary').click();
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
  const localTimes = await page.evaluate(() => ['2026-10-01T10:00:00Z','2026-10-01T10:20:34Z'].map(s => new Date(s).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })));
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
