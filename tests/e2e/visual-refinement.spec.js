import { test, expect } from '@playwright/test';
import { mockApp, sessionId } from '../helpers/nfc-app.js';

for (const theme of ['reading-room', 'terminal']) {
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    test(`${theme} session actions and ruled fields at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await mockApp(page, { theme });
      await page.goto(`/#/reading-session/${sessionId}/finish`);
      const save = page.getByRole('button', { name: 'Save session', exact: true });
      await expect(save).toBeInViewport();
      const geometry = await page.evaluate(() => {
        const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
        return { button: rect('[type="submit"]'), nav: rect('.bottom-nav'), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(geometry.overflow).toBe(false);
      if (width < 900) expect(geometry.button.bottom).toBeLessThan(geometry.nav.top);
      await page.getByRole('spinbutton').fill('280');
      await expect(page.locator('[data-session-pages]')).toHaveText('7');
      await expect(page.locator('[data-session-pace]')).toHaveText('20.4 pages/hour');
      await expect(page.locator('.session-stamp').first()).toContainText('1 Oct 2026');
      await page.locator('#nfc-session-kind').scrollIntoViewIfNeeded();
      await page.locator('#nfc-session-kind').selectOption('test');
      await expect(page.locator('#nfc-session-kind')).toHaveValue('test');
      await page.screenshot({ animations: 'disabled', path: `output/playwright/refinement/${test.info().project.name}-${theme}-${width}-finish.png` });
    });
  }
}

test('startup paints before CSS, hands off without waiting for covers and never replays on navigation or foreground', async ({ page }) => {
  await mockApp(page, { bookOverrides: { cover_url: '/delayed-cover.jpg' } });
  let releaseModule, releaseCss, releaseData;
  const moduleGate = new Promise(resolve => { releaseModule = resolve; });
  const cssGate = new Promise(resolve => { releaseCss = resolve; });
  const dataGate = new Promise(resolve => { releaseData = resolve; });
  await page.route('**/rest/v1/reader_profiles*', async route => { await dataGate; await route.fallback(); });
  await page.route('**/dist/app.js*', async route => { await moduleGate; await route.continue(); });
  await page.route('**/src/styles/app.css*', async route => { await cssGate; await route.continue(); });
  await page.route('**/delayed-cover.jpg', () => {});
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.getByText('Entering Reading Room')).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe('rgb(241, 238, 229)');
  expect(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor)).toBe('rgb(241, 238, 229)');
  releaseCss();
  releaseModule();
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({ path: `output/playwright/refinement/${test.info().project.name}-loading.png` });
  releaseData();
  await expect(page.locator('#app')).toHaveAttribute('data-route-view', 'home');
  await expect(page.locator('.boot-screen')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/booting/);
  await page.locator('.bottom-nav [data-route="library"]').click();
  await expect(page.locator('.header-title')).toHaveText('Library');
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('.boot-screen')).toHaveCount(0);
});

test('long titles, missing covers, enlarged preferences and short viewports remain scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockApp(page, { bookOverrides: { title: 'An Extremely Long Chronicle of the Library and Everything We Remembered About the World', authors: 'A Long Author Name, Another Author Name and A Third Author' }, appearance: { baseSize: 20, headingAdjust: 8, density: 1.2 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  await expect(page.locator('.session-book-heading .cover-fallback')).toBeVisible();
  const input = page.getByRole('spinbutton');
  await input.scrollIntoViewIfNeeded(); await input.fill('290');
  await expect(input).toBeInViewport();
  const save = page.getByRole('button', { name: 'Save session', exact: true });
  await expect(save).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test('keyboard viewport and short landscape use normal scrolling for the submit area', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApp(page);
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  await page.getByRole('spinbutton').click();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 500 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await expect(page.locator('.layout')).toHaveClass(/session-keyboard-open/);
  expect(await page.locator('.session-submit-area').evaluate(node => getComputedStyle(node).position)).toBe('static');
  await page.getByRole('button', { name: 'Save session', exact: true }).scrollIntoViewIfNeeded();
  await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')); });
  await page.setViewportSize({ width: 667, height: 375 });
  expect(await page.locator('.session-submit-area').evaluate(node => getComputedStyle(node).position)).toBe('static');
  await page.getByRole('button', { name: 'Save session', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Save session', exact: true })).toBeInViewport();
});

test('simulated safe-area and a larger navigation dock leave the submit action clear', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApp(page, { theme: 'terminal', appearance: { navHeight: 72 } });
  await page.goto(`/#/reading-session/${sessionId}/finish`);
  await expect(page.getByRole('button', { name: 'Save session', exact: true })).toBeVisible();
  await page.addStyleTag({ content: ':root { --safe-top: 47px; --safe-bottom: 34px; }' });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  const bounds = await page.evaluate(() => {
    const button = document.querySelector('[type="submit"]').getBoundingClientRect();
    const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
    return { bottom: button.bottom, height: button.height, navTop: nav.top };
  });
  expect(bounds.bottom).toBeLessThan(bounds.navTop);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
});

for (const status of ['Owned - Unread', 'Paused', 'Read', 'Wishlist', 'Currently Reading']) {
  test(`${status} keeps exactly one cover action in its intended location`, async ({ page }) => {
    await mockApp(page, { otherBookOverrides: { overall_status: status, ownership_status: status === 'Wishlist' ? 'Not Owned' : 'Owned' } });
    await page.goto('/#/book/book-2');
    await expect(page.locator('[data-library-detail="ready"]')).toBeVisible();
    await expect(page.locator('[data-cover-picker]')).toHaveCount(1);
    const reading = status === 'Currently Reading';
    await expect(page.locator('.progress-actions [data-cover-picker]')).toHaveCount(reading ? 1 : 0);
    await expect(page.locator('.metadata-accordion [data-cover-picker]')).toHaveCount(reading ? 0 : 1);
    const startable = ['Owned - Unread', 'Paused'].includes(status);
    await expect(page.locator('[data-start]')).toHaveCount(startable ? 1 : 0);
    if (startable) {
      const order = await page.evaluate(() => {
        const start = document.querySelector('[data-start]');
        return { afterRatings: !!(document.querySelector('.rating-strip').compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING), beforeSynopsis: !!(start.compareDocumentPosition(document.querySelector('.book-synopsis')) & Node.DOCUMENT_POSITION_FOLLOWING) };
      });
      expect(order).toEqual({ afterRatings: true, beforeSynopsis: true });
    }
    if (!reading) {
      await page.locator('.metadata-accordion summary').click();
      await expect(page.locator('[data-book-admin] + [data-cover-picker]')).toBeVisible();
    } else {
      for (const action of ['progress', 'finish', 'pause', 'dnf', 'cover-picker']) await expect(page.locator(`.progress-actions [data-${action}]`)).toHaveCount(1);
    }
  });
}
