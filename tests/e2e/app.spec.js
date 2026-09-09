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
  await page.goto('/tests/e2e/fixture.html');
  await expect(page.getByRole('heading', { name: 'Currently One' })).toBeVisible();
  await page.locator('[data-route="library"]').first().click();
  await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible();
  await page.locator('[data-filter="Read"]').click();
  await expect(page.locator('.book-card')).toHaveCount(1);
  await page.locator('.book-card').click();
  await expect(page.locator('.detail-header[data-library-detail="ready"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Quotes & passages 1' })).toBeVisible();
  await expect(page.locator('.rating-public')).toBeVisible();
  await page.locator('[data-back]').click();
  await expect(page.getByRole('heading', { name: 'Read' })).toBeVisible();
});

test('currently-reading carousel and wishlist render directly', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html');
  await expect(page.locator('[data-current-card]')).toHaveCount(2);
  await expect(page.locator('[data-carousel-dot]')).toHaveCount(2);
  await page.locator('[data-route="wishlist"]').first().click();
  await expect(page.getByRole('heading', { name: 'Wishlist' })).toBeVisible();
  await expect(page.locator('.book-card')).toHaveCount(1);
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

test('a failed cover keeps its reserved geometry and fallback', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html');
  const cover = page.locator('[data-current-card="current-1"] .cover');
  await expect(cover).toBeVisible();
  await expect(cover.locator('.cover-fallback')).toBeVisible();
  const box = await cover.boundingBox();
  expect(box.height).toBeGreaterThan(100);
  expect(Math.abs((box.width / box.height) - (2 / 3))).toBeLessThan(0.03);
});
