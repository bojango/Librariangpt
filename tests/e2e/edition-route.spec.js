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
      cover_url: '/wishlist-cover.jpg'
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
      if (records.some(record => record.type === 'childList' && (record.target.id === 'app' || record.target.classList?.contains('layout')))) window.__refreshPaints += 1;
    }).observe(document.querySelector('#app'), { childList: true, subtree: true });
  });
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/rest/v1/v_library?')),
    page.evaluate(() => window.dispatchEvent(new CustomEvent('reading-room:refresh')))
  ]);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__refreshPaints)).toBe(0);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - beforeY)).toBeLessThanOrEqual(2);

  await page.locator('.cover-image').first().evaluate(image => { image.dataset.instanceMarker = 'same-cover'; });
  backend.bump();
  backend.setLatency(450);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('reading-room:refresh')));
  await expect(page.locator('.book-title', { hasText: 'Unread 00 revision 1' }).first()).toBeVisible();
  await expect(page.locator('.cover-image').first()).toHaveAttribute('data-instance-marker', 'same-cover');
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - beforeY)).toBeLessThanOrEqual(2);
  await expect(page).toHaveURL(/#\/home$/);
});

test('cold authenticated route paints once and preserves persistent chrome', async ({ page }) => {
  await page.addInitScript(() => {
    window.__appRootPaints = 0;
    const replaceChildren = Element.prototype.replaceChildren;
    Element.prototype.replaceChildren = function (...nodes) {
      if (this.id === 'app') window.__appRootPaints += 1;
      return replaceChildren.apply(this, nodes);
    };
  });
  await mockAuthenticatedLibrary(page);
  await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'home');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => window.__appRootPaints)).toBe(1);

  await page.locator('.topbar').evaluate(element => { element.dataset.instanceMarker = 'persistent'; });
  await page.locator('[data-route="library"]').first().click();
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'library');
  await expect(page.locator('main')).toHaveClass(/route-enter/);
  await expect(page.locator('.topbar')).toHaveAttribute('data-instance-marker', 'persistent');
  expect(await page.evaluate(() => window.__appRootPaints)).toBe(1);
});

test('scrolling and lifecycle exits persist position while resume leaves native viewport untouched', async ({ page }) => {
  await mockAuthenticatedLibrary(page);
  await page.goto('/#/home');
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'home');
  await page.evaluate(() => window.scrollTo(0, 1000));
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('reading-room-scroll-v2') || '{}').home || 0)).toBeGreaterThan(800);
  const before = await page.evaluate(() => window.scrollY);

  await page.evaluate(() => {
    const nativeScrollTo = window.scrollTo.bind(window);
    window.__resumeScrollCalls = [];
    window.scrollTo = (...args) => { window.__resumeScrollCalls.push(args); nativeScrollTo(...args); };
    window.dispatchEvent(new Event('pagehide'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    const show = new Event('pageshow');
    Object.defineProperty(show, 'persisted', { value: true });
    window.dispatchEvent(show);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.evaluate(() => window.__resumeScrollCalls.length)).toBe(0);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('reading-room-scroll-v2')).home)).toBe(before);
  await expect(page.locator('main')).not.toHaveClass(/route-enter/);
});

test('true route return restores Home scroll and only navigation transitions', async ({ page }) => {
  await mockAuthenticatedLibrary(page);
  await page.goto('/#/home');
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'home');
  await page.evaluate(() => window.scrollTo(0, 1000));
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('reading-room-scroll-v2') || '{}').home || 0)).toBeGreaterThan(800);
  const savedHome = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reading-room-scroll-v2')).home);
  await page.evaluate(() => {
    window.__routeTransitions = 0;
    document.addEventListener('animationstart', event => { if (event.animationName === 'route-enter') window.__routeTransitions += 1; });
  });
  await page.locator('[data-route="library"]').first().evaluate(element => element.click());
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'library');
  await page.locator('.bottom-nav [data-route="home"]').evaluate(element => element.click());
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'home');
  await page.waitForTimeout(250);
  const metrics = await page.evaluate(() => ({ y: window.scrollY, max: document.documentElement.scrollHeight - innerHeight, stored: JSON.parse(sessionStorage.getItem('reading-room-scroll-v2')).home }));
  expect(metrics.y, JSON.stringify(metrics)).toBeGreaterThanOrEqual(Math.min(savedHome, metrics.max) - 2);
  const restoredY = await page.evaluate(() => window.scrollY);
  await expect(page.locator('main')).not.toHaveClass(/route-enter/);
  expect(await page.evaluate(() => window.__routeTransitions)).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('reading-room:refresh')));
  await expect(page.locator('main')).not.toHaveClass(/route-enter/);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - restoredY)).toBeLessThanOrEqual(2);
});

test('book navigation owns one zero position before restoring Home scroll once', async ({ page }) => {
  await mockAuthenticatedLibrary(page);
  await page.goto('/#/home');
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'home');
  await page.evaluate(() => window.scrollTo(0, 1000));
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('reading-room-scroll-v2') || '{}').home || 0)).toBeGreaterThan(800);
  await page.evaluate(() => {
    const nativeScrollTo = window.scrollTo.bind(window);
    window.__routeScrolls = [];
    window.scrollTo = function (options) {
      window.__routeScrolls.push(typeof options === 'object' ? options.top : arguments[1]);
      nativeScrollTo(options);
    };
  });
  await page.locator('[data-open-book="book-1"]').first().click();
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'book');
  await expect(page.locator('.detail-header[data-book-id="book-1"]')).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => window.__routeScrolls.every(value => value === 0))).toBe(true);
  const callsBeforeBack = await page.evaluate(() => window.__routeScrolls.length);
  const sourcePosition = await page.evaluate(() => JSON.parse(sessionStorage.getItem('reading-room-scroll-v2')).home);
  await page.locator('[data-back]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'home');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(sourcePosition - 2);
  expect(await page.evaluate(from => window.__routeScrolls.slice(from).filter(value => value > 0), callsBeforeBack)).toEqual([sourcePosition]);
});

test('mobile nav uses route indexes and stays compact at the document bottom', async ({ page }) => {
  await mockAuthenticatedLibrary(page);
  await page.goto('/#/home');
  for (const [route, index] of [['home', '0'], ['library', '1'], ['wishlist', '2'], ['stats', '3']]) {
    await page.locator(`.bottom-nav [data-route="${route}"]`).click();
    await expect(page.locator('#app')).toHaveAttribute('data-route-view', route);
    expect(await page.locator('.bottom-nav').evaluate(element => getComputedStyle(element).getPropertyValue('--nav-index').trim())).toBe(index);
  }
  await page.locator('.bottom-nav [data-route="library"]').click();
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'library');
  await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav');
    nav.classList.add('compact');
    window.scrollTo(0, document.documentElement.scrollHeight - innerHeight);
    window.dispatchEvent(new Event('scroll'));
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await expect(page.locator('.bottom-nav')).toHaveClass(/compact/);
});

test('reduced motion disables the route-entry animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockAuthenticatedLibrary(page);
  await page.goto('/#/home');
  await page.locator('[data-route="library"]').first().click();
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'library');
  await expect(page.locator('main')).not.toHaveClass(/route-enter/);
  expect(await page.locator('main').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});
