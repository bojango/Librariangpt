import { test, expect } from '@playwright/test';

test('cold launch renders the authentication shell without overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Reading Room');
  await expect(page.getByRole('heading', { name: 'Your library.' })).toBeVisible();
  await expect(page.locator('#auth-form').getByRole('button', { name: 'Sign in' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('auth mode changes without navigation or duplicate forms', async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-auth-mode="signup"]').click();
  await expect(page.locator('[data-auth-mode="signup"]')).toHaveClass(/active/);
  await expect(page.locator('#auth-form')).toHaveCount(1);
});

test('authenticated fixture supports route, filter and detail lifecycles', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'The Unfinished Harauld Hughes' })).toBeVisible();
  await page.locator('[data-route="library"]').first().click();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await page.locator('[data-filter="Read"]').click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.locator('.book-card').click();
  await expect(page.locator('.detail-header[data-library-detail="ready"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quotes & passages 1' })).toBeVisible();
  await expect(page.locator('.rating-public')).toBeVisible();
  await expect(page.locator('related-books')).toHaveCount(1);
  await page.locator('[data-back]').click();
  await expect(page.getByRole('heading', { name: 'Read' })).toBeVisible();
});

test('currently-reading carousel and wishlist render directly', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-current-card]')).toHaveCount(2);
  await expect(page.locator('[data-carousel-dot]')).toHaveCount(2);
  await page.locator('[data-route="wishlist"]').first().click();
  await expect(page.getByRole('heading', { name: 'Wishlist' })).toBeVisible();
  await expect(page.locator('.book-card')).toHaveCount(1);
});

test('long current title has its final class in initial markup and never mutates later', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  const title = page.locator('[data-current-card="current-1"] h1');
  await expect(title).toHaveClass('current-title-compact-v37');
  await expect(title).toHaveAttribute('data-title-variant', 'compact');
  await expect(title).toHaveAttribute('style', /font-size:clamp\(31px,5\.2vw,58px\)!important/);
  const initial = await title.getAttribute('class');
  const mutations = await title.evaluate(element => new Promise(resolve => {
    let count = 0;
    const observer = new MutationObserver(records => { count += records.filter(record => record.attributeName === 'class').length; });
    observer.observe(element, { attributes: true, attributeFilter: ['class'] });
    requestAnimationFrame(() => requestAnimationFrame(() => { observer.disconnect(); resolve(count); }));
  }));
  expect(mutations).toBe(0);
  await expect(title).toHaveClass(initial);
  const beforeResume = await title.evaluate(element => ({ className: element.className, style: element.getAttribute('style') }));
  await page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    window.dispatchEvent(event);
  });
  expect(await title.evaluate(element => ({ className: element.className, style: element.getAttribute('style') }))).toEqual(beforeResume);
});

test('detail and modal layouts do not overflow a mobile viewport', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html#/book/read-1');
  await expect(page.locator('.detail-header')).toBeVisible();
  await page.evaluate(() => { document.querySelector('#modal-root').innerHTML = '<div class="modal-backdrop"><div class="modal book-admin-modal"><h2>Settings</h2><textarea>Long content</textarea></div></div>'; });
  const sizes = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: document.documentElement.clientWidth, modal: document.querySelector('.modal').getBoundingClientRect() }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.modal.width).toBeLessThanOrEqual(sizes.viewport);
});

test('service worker shell references resolve', async ({ request }) => {
  const source = await (await request.get('/sw.js')).text();
  const assets = [...source.matchAll(/^\s*'\.\/([^']+)'/gm)].map(match => `/${match[1]}`);
  for (const asset of assets) expect((await request.get(asset)).ok(), asset).toBe(true);
});

test('service worker and document reference one coherent shell generation', async ({ request }) => {
  const html = await (await request.get('/index.html')).text();
  const worker = await (await request.get('/sw.js')).text();
  const generation = html.match(/name="reading-room-generation" content="(\d+)"/)?.[1];
  expect(generation).toBeTruthy();
  const assetGenerations = [...html.matchAll(/[?&]v=(\d+)/g)].map(match => match[1]);
  expect(new Set(assetGenerations)).toEqual(new Set([generation]));
  expect(worker).toContain(`const GENERATION = '${generation}'`);
  for (const value of [...worker.matchAll(/[?&]v=(\d+)/g)].map(match => match[1])) expect(value).toBe(generation);
});

test('rapid route changes only leave the final route rendered', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html');
  await page.evaluate(() => {
    location.hash = '#/library';
    location.hash = '#/wishlist';
    location.hash = '#/stats';
  });
  await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
  await expect(page.locator('.page-heading h1')).toHaveCount(1);
});

test('rapid Home to Library to Home navigation renders Home completely', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html');
  await page.locator('[data-route="library"]').first().click();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await page.locator('[data-route="home"]').first().click();
  await expect(page.locator('[data-carousel]')).toBeVisible();
  await expect(page.locator('#up-next-section')).toBeVisible();
  await expect(page.locator('#ai-recommended-section')).toBeVisible();
  await expect(page).toHaveURL(/#\/home$/);
});

test('a failed cover keeps its reserved geometry and fallback', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html');
  const cover = page.locator('[data-current-card="current-2"] .cover');
  await expect(cover).toBeVisible();
  await expect(cover).toHaveClass(/cover-failed/);
  await expect(cover.locator('.cover-fallback')).toBeVisible();
  await expect(cover.locator('.cover-image')).toBeHidden();
  const box = await cover.boundingBox();
  expect(box.height).toBeGreaterThan(100);
  expect(Math.abs((box.width / box.height) - (2 / 3))).toBeLessThan(0.03);
});

test('same-route refresh preserves exact Home scroll and skips unchanged paints', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html');
  await page.evaluate(() => window.scrollTo(0, 1000));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(800);
  const before = await page.evaluate(() => ({ y: window.scrollY, paints: window.fixturePaints, hash: location.hash }));
  await page.locator('[data-current-card="current-1"] .cover-image').evaluate(image => { image.dataset.instanceMarker = 'preserve-me'; });

  await page.evaluate(() => window.fixtureRefresh({}));
  expect(await page.evaluate(() => window.fixturePaints)).toBe(before.paints);

  await page.evaluate(() => window.fixtureRefresh({ upNext: [{ queue_id: 'queue-1', id: 'wish-1', title: 'Wish Book', authors: 'Future Author', position: 1, source: 'Manual', locked: true, reason: 'Updated in the background.' }] }));
  const after = await page.evaluate(() => ({ y: window.scrollY, paints: window.fixturePaints, hash: location.hash }));
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
  expect(after.paints).toBe(before.paints + 1);
  expect(after.hash).toBe(before.hash);
  await expect(page.locator('[data-current-card="current-1"] .cover-image')).toHaveAttribute('data-instance-marker', 'preserve-me');
  await expect(page.locator('[data-current-card="current-1"] .cover-image')).toHaveCSS('opacity', '1');
});

test('catalogue cover priority is limited to the visible rows', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html#/library');
  await expect(page.locator('.library-grid .cover-image').first()).toHaveAttribute('loading', 'eager');
  await expect(page.locator('.library-grid .cover-image').first()).toHaveAttribute('fetchpriority', 'high');
  await expect(page.locator('[data-open-book="wish-1"] .cover-image')).toHaveAttribute('loading', 'lazy');
  await page.locator('[data-route="wishlist"]').first().click();
  await expect(page.locator('[data-open-book="wish-1"] .cover-image')).toHaveAttribute('loading', 'eager');
  await expect(page.locator('[data-open-book="wish-1"] .cover-image')).toHaveAttribute('fetchpriority', 'high');
});

test('delayed cover starts from initial markup over an invariant fallback box', async ({ page }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/delayed-cover.svg', async route => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#345"/></svg>' });
  });
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  const cover = page.locator('[data-current-card="current-1"] .cover');
  const before = await cover.boundingBox();
  await expect(cover.locator('.cover-fallback')).toBeVisible();
  await expect(cover.locator('img')).toHaveAttribute('src', '/delayed-cover.svg');
  await expect(cover.locator('img')).toHaveAttribute('loading', 'eager');
  await expect(cover.locator('img')).toHaveAttribute('fetchpriority', 'high');
  expect(await cover.locator('img').evaluate(image => getComputedStyle(image).opacity)).toBe('1');
  release();
  await expect(cover).toHaveClass(/cover-loaded/);
  const after = await cover.boundingBox();
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
});

test('stale delayed cover cannot replace a newer URL during refresh', async ({ page }) => {
  let releaseOld;
  const gate = new Promise(resolve => { releaseOld = resolve; });
  await page.route('**/delayed-cover.svg', async route => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="red"/></svg>' });
  });
  await page.goto('/tests/e2e/fixture.html', { waitUntil: 'domcontentloaded' });
  const stateCover = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="600"%3E%3Crect width="400" height="600" fill="green"/%3E%3C/svg%3E';
  await page.evaluate(url => window.fixtureSetCover(url), stateCover);
  const current = page.locator('[data-current-card="current-1"] .cover');
  await expect(current).toHaveAttribute('data-cover-url', stateCover);
  await expect(current).toHaveClass(/cover-loaded/);
  releaseOld();
  await page.waitForTimeout(100);
  await expect(current).toHaveAttribute('data-cover-url', stateCover);
  await expect(current.locator('img')).toHaveAttribute('data-cover-url', stateCover);
});

test('Home structural shelves render without a scroll event after navigation', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html#/book/read-1');
  await page.locator('[data-route="home"]').first().click();
  await expect(page.locator('[data-carousel]')).toBeVisible();
  await expect(page.locator('#up-next-section')).toBeVisible();
  await expect(page.locator('#ai-recommended-section')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Owned & unread' })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test.describe('service-worker-controlled document', () => {
  test.use({ serviceWorkers: 'allow' });

  test('reload keeps HTML, CSS and JavaScript on the same generation', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'load' });
    expect(await page.locator('meta[name="reading-room-generation"]').getAttribute('content')).toBe('52');
    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).filter(name => /(?:app\.css|app\.js)/.test(name)));
    expect(resources.length).toBeGreaterThanOrEqual(2);
    expect(resources.every(url => new URL(url).searchParams.get('v') === '52')).toBe(true);
    expect(await page.evaluate(() => caches.keys())).toContain('reading-room-shell-v52');
  });

  test('Test Mode can request aggregate service-worker diagnostic state', async ({ page }) => {
    await page.goto('/?test=1');
    await page.evaluate(() => navigator.serviceWorker.ready);
    if (!await page.evaluate(() => Boolean(navigator.serviceWorker.controller))) await page.reload({ waitUntil: 'load' });
    const state = await page.evaluate(() => new Promise(resolve => {
      const channel = new MessageChannel();
      channel.port1.onmessage = event => resolve(event.data);
      navigator.serviceWorker.controller.postMessage({ type: 'GET_DIAGNOSTIC_STATE' }, [channel.port2]);
    }));
    expect(state).toMatchObject({ generation: '52', shell_cache: 'reading-room-shell-v52', cover_cache: 'reading-room-covers-v3' });
    expect(state.cover_cache_hits).toBeGreaterThanOrEqual(0);
    expect(state.cover_cache_misses).toBeGreaterThanOrEqual(0);
    expect(state.cover_network_fetches).toBeGreaterThanOrEqual(0);
  });
});
