import { test, expect } from '@playwright/test';

const project = 'fbbpovieqfsjunmqtxvf';
const api = `https://${project}.supabase.co`;

function jwt(userId) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: userId, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${payload}.fixture-signature`;
}

async function mockAuthenticatedLibrary(page) {
  const user = { id: 'fixture-user', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test' };
  const accessToken = jwt(user.id);
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: `sb-${project}-auth-token`,
    value: { access_token: accessToken, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  });

  let selected = 'edition-old';
  let revision = 0;
  let latency = 0;
  let snapshotRequests = 0;
  const editions = [
    { id: 'edition-old', book_id: 'book-1', format: 'Paperback', publication_year: 2020, page_count: 220, language: 'English', isbn13: '9780306406157' },
    { id: 'edition-new', book_id: 'book-1', format: 'Hardcover', publication_year: 2025, page_count: 300, language: 'English', isbn13: '9783161484100' }
  ];
  const book = () => ({
    id: 'book-1',
    title: 'Edition Route Book',
    authors: 'Fixture Author',
    overall_status: 'Read',
    ownership_status: 'Owned',
    current_edition_id: selected,
    display_edition_id: selected,
    reference_edition_id: selected,
    edition_format: selected === 'edition-new' ? 'Hardcover' : 'Paperback',
    edition_year: selected === 'edition-new' ? 2025 : 2020,
    edition_page_count: selected === 'edition-new' ? 300 : 220,
    total_pages: selected === 'edition-new' ? 300 : 220,
    primary_genre: 'Fiction',
    synopsis: 'A deterministic detail record.',
    metadata_status: 'complete',
    cover_url: ''
  });
  const library = () => [
    book(),
    ...Array.from({ length: 32 }, (_, index) => ({
      id: `unread-${index}`,
      title: `Unread ${String(index).padStart(2, '0')}${index === 0 ? ` revision ${revision}` : ''}`,
      authors: 'Fixture Author',
      overall_status: 'Owned - Unread',
      ownership_status: 'Owned',
      primary_genre: 'Fiction',
      cover_url: ''
    }))
  ];

  await page.route(`${api}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': '*' } });

    if (path === '/auth/v1/user') return json(user);
    if (path.includes('/rest/v1/rpc/select_book_edition')) {
      selected = request.postDataJSON().p_edition_id;
      return json(selected);
    }
    if (path.includes('/rest/v1/v_library_chapters')) return json([]);
    if (path.includes('/rest/v1/v_ai_recommendations')) return json([]);
    if (path.includes('/rest/v1/v_up_next')) return json([]);
    if (path.includes('/rest/v1/public_ratings')) return json([]);
    if (path.includes('/rest/v1/book_quotes')) return json([]);
    if (path.includes('/rest/v1/recommendations')) return url.searchParams.has('book_id') ? json(null) : json([]);
    if (path.includes('/rest/v1/editions')) return json(editions);
    if (path.includes('/rest/v1/books')) return json({ editions_status: 'complete', editions_last_refreshed_at: new Date().toISOString(), editions_error: null, metadata_status: 'complete', metadata_retry_after: null });
    if (path.includes('/rest/v1/v_library')) {
      if (latency) await new Promise(resolve => setTimeout(resolve, latency));
      if (!url.searchParams.has('id')) snapshotRequests += 1;
      return url.searchParams.has('id') ? json(book()) : json(library());
    }
    return json({});
  });
  return {
    bump: () => { revision += 1; },
    setLatency: value => { latency = value; },
    get snapshotRequests() { return snapshotRequests; }
  };
}

test('edition mutation refreshes the same book without rendering Home', async ({ page }) => {
  await mockAuthenticatedLibrary(page);
  await page.goto('/#/book/book-1');
  await expect(page.locator('.detail-header[data-book-id="book-1"]')).toBeVisible();
  await page.evaluate(() => {
    window.__homeRenderedDuringEdition = false;
    new MutationObserver(() => {
      if (document.querySelector('#app')?.dataset.routeView === 'home' || document.querySelector('#up-next-section')) window.__homeRenderedDuringEdition = true;
    }).observe(document.querySelector('#app'), { childList: true, subtree: true, attributes: true });
  });

  await page.locator('.metadata-accordion summary').click();
  await page.locator('[data-editions]').click();
  await expect(page.locator('.edition-browser-modal')).toBeVisible();
  await page.locator('[data-edition-own="edition-new"]').click();

  await expect(page).toHaveURL(/#\/book\/book-1$/);
  await expect(page.locator('.detail-header[data-book-id="book-1"]')).toBeVisible();
  await page.locator('.metadata-accordion summary').click();
  await expect(page.locator('.metadata-list')).toContainText('Hardcover');
  await expect(page.locator('.metadata-list')).toContainText('2025');
  expect(await page.evaluate(() => window.__homeRenderedDuringEdition)).toBe(false);

  await page.locator('.wordmark[data-route="home"]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'home');
  await expect(page.getByRole('heading', { name: 'Nothing currently open.' })).toBeVisible();
  await expect(page.locator('#up-next-section')).toBeVisible();
  await expect(page.locator('#ai-recommended-section')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Owned & unread' })).toBeVisible();
});

test('real same-route Home refresh preserves scroll and skips unchanged repaint', async ({ page }) => {
  const backend = await mockAuthenticatedLibrary(page);
  await page.goto('/#/home');
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'home');
  expect(backend.snapshotRequests).toBe(1);
  await page.evaluate(() => window.scrollTo(0, 1000));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
  const beforeY = await page.evaluate(() => window.scrollY);

  await page.evaluate(() => {
    window.__refreshPaints = 0;
    new MutationObserver(records => {
      if (records.some(record => record.type === 'childList' && record.target.id === 'app')) window.__refreshPaints += 1;
    }).observe(document.querySelector('#app'), { childList: true });
  });
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/rest/v1/v_library?')),
    page.evaluate(() => window.dispatchEvent(new CustomEvent('reading-room:refresh')))
  ]);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__refreshPaints)).toBe(0);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - beforeY)).toBeLessThanOrEqual(2);

  backend.bump();
  backend.setLatency(450);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('reading-room:refresh')));
  await expect(page.locator('.book-title', { hasText: 'Unread 00 revision 1' }).first()).toBeVisible();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - beforeY)).toBeLessThanOrEqual(2);
  await expect(page).toHaveURL(/#\/home$/);
});
