// Local rendered evidence with a fully isolated HTTP backend. Never writes live data.
import { chromium, webkit, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { mockApp, sessionId } from '../tests/helpers/nfc-app.js';

const folder = 'output/playwright/refinement';
await mkdir(folder, { recursive: true });
const evidence = { backend: 'isolated fixtures', physicalIphone: false, checks: [] };
const cover = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#374448"/><text x="30" y="90" fill="#f1eee5" font-family="serif" font-size="50">INFLUX</text><text x="30" y="550" fill="#f1eee5" font-family="sans-serif" font-size="24">DANIEL SUAREZ</text></svg>';

for (const [engine, type] of Object.entries({ chromium, webkit })) {
  const browser = await type.launch();
  for (const theme of ['reading-room', 'terminal']) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    await page.addInitScript(() => {
      // Avoid unrelated background enrichment replacing a detail during capture.
      for (const id of ['book-1', 'book-2']) for (const kind of ['enrich', 'goodreads']) sessionStorage.setItem(`reading-room-${kind}:${id}`, String(Date.now()));
    });
    const mock = await mockApp(page, { theme, activeOnLaunch: true, bookOverrides: { title: 'Influx', authors: 'Daniel Suarez', cover_url: '/fixture-session-cover.svg' } });
    await page.route('**/fixture-session-cover.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: cover }));
    const errors = []; page.on('pageerror', e => errors.push(e.stack));
    await page.goto('http://127.0.0.1:4173/');
    await expect(page.locator('[data-session-timer]')).toBeVisible();
    await expect(page.locator('.boot-screen')).toHaveCount(0);
    await page.screenshot({ animations: 'disabled', path: `${folder}/${engine}-${theme}-active.png` });
    const before = await page.locator('[data-session-timer]').textContent();
    await expect.poll(() => page.locator('[data-session-timer]').textContent()).not.toBe(before);
    await page.getByRole('button', { name: 'End session', exact: true }).click();
    await expect(page.locator('#nfc-finish-form')).toBeVisible();
    await page.getByRole('spinbutton').fill('280');
    await page.screenshot({ animations: 'disabled', path: `${folder}/${engine}-${theme}-finished.png` });
    const geometry = await page.evaluate(() => {
      const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
      return { save: rect('[type="submit"]'), nav: rect('.bottom-nav'), kind: rect('#nfc-session-kind'), height: innerHeight, scroll: scrollY, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    evidence.checks.push({ engine, theme, geometry, timerAdvanced: true });
    await expect(page.getByRole('button', { name: 'Save session', exact: true })).toBeInViewport();
    await page.getByRole('button', { name: 'Save session', exact: true }).click();
    await expect(page.locator('[data-library-detail="ready"]')).toBeVisible();
    if (mock.saves.length !== 1) throw new Error('Expected one session save');
    await page.locator('.progress-actions').evaluate(node => node.scrollIntoView({ block: 'center' }));
    await page.screenshot({ animations: 'disabled', path: `${folder}/${engine}-${theme}-currently-reading.png` });
    await page.goto('http://127.0.0.1:4173/#/book/book-2');
    await expect(page.locator('[data-library-detail="ready"]')).toBeVisible();
    await page.locator('.rating-strip').evaluate(node => node.scrollIntoView({ block: 'center' }));
    await page.screenshot({ animations: 'disabled', path: `${folder}/${engine}-${theme}-unread.png` });
    await page.locator('.metadata-accordion summary').click();
    await page.locator('.metadata-accordion').evaluate(node => node.scrollIntoView({ block: 'start' }));
    await page.screenshot({ animations: 'disabled', path: `${folder}/${engine}-${theme}-edition-details.png` });
    mock.setDestination(null);
    await page.goto('http://127.0.0.1:4173/#/home');
    await expect(page.locator('[data-current-card]')).toBeVisible();
    await page.screenshot({ animations: 'disabled', path: `${folder}/${engine}-${theme}-home.png` });
    for (const route of ['library', 'profile', 'home']) {
      await page.goto(`http://127.0.0.1:4173/#/${route}`);
      await expect(page.locator('#app')).toHaveAttribute('data-route-view', route);
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`${route} overflow`);
    }
    if (errors.length) throw new Error(errors.join('\n'));
    await context.close();
  }
  await browser.close();
}
await writeFile(`${folder}/evidence.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
