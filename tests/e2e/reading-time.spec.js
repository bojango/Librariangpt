import { test, expect } from '@playwright/test';

async function seedTime(page) {
  await page.evaluate(() => {
    const year = new Date().getFullYear();
    const time = (day, hour, minute = 0) => new Date(year, 0, day, hour, minute).toISOString();
    const session = (start, end, extra = {}) => ({ book_id: 'read-1', session_kind: 'reading', started_at: start, ended_at: end, ...extra });
    Object.assign(window.fixtureState.books.find(book => book.id === 'read-1'), { started_at: `${year}-01-01`, completed_at: `${year}-01-05` });
    window.fixtureRefresh({ readingTimeSessions: [
      session(time(1, 10), time(1, 11)),
      session(time(1, 14), time(1, 14, 30)),
      session(time(2, 23, 30), time(3, 0, 30)),
      session(new Date(year - 1, 5, 1, 10).toISOString(), new Date(year - 1, 5, 1, 11).toISOString()),
      session(time(4, 10), time(4, 18), { session_kind: 'test' }),
      session(time(5, 10), null)
    ] });
  });
}

test('book reading time preserves the card order, styling, and two-column mobile grid', async ({ page }, testInfo) => {
  await page.goto('/tests/e2e/fixture.html#/book/read-1');
  await seedTime(page);
  const cards = page.locator('.reading-stats-grid > div');
  await expect(cards.locator('small')).toHaveText(['Started', 'Finished', 'Days reading', 'Pages / day', 'Time reading', 'Time / day', 'Length', 'Est. word count']);
  await expect(cards.nth(4).locator('strong')).toHaveText('03:30:00');
  await expect(cards.nth(5).locator('strong')).toHaveText('00:52:30');
  const geometry = await cards.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    const value = getComputedStyle(node.querySelector('strong'));
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, padding: style.padding, border: style.border, background: style.background, radius: style.borderRadius, font: value.font };
  }));
  expect(geometry[4]).toEqual({ ...geometry[2], y: geometry[4].y });
  expect(geometry[5]).toEqual({ ...geometry[3], y: geometry[5].y });
  expect(geometry[4].y).toBe(geometry[5].y);
  expect(geometry[4].y).toBeGreaterThan(geometry[2].y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.locator('.reading-stats').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('book-reading-time.png') });
});

test('profile reading time uses the existing rows and local calendar aggregates', async ({ page }, testInfo) => {
  await page.goto('/tests/e2e/fixture.html#/profile');
  await page.getByRole('tab', { name: 'Stats', exact: true }).click();
  await seedTime(page);
  const rows = page.locator('.profile-stat-row');
  await expect(rows.locator('span')).toHaveText(['BOOKS READ', 'READ THIS YEAR', 'CURRENTLY READING', 'OWNED / UNREAD', 'WISHLIST', 'AVERAGE RATING', 'KNOWN PAGES READ', 'READING TIME THIS YEAR', 'TOTAL READING TIME', 'AVG READING DAY', 'AVG SESSION']);
  await expect(rows.nth(7).locator('strong')).toHaveText('2h 30m');
  await expect(rows.nth(8).locator('strong')).toHaveText('3h 30m');
  await expect(rows.nth(9).locator('strong')).toHaveText('52m');
  await expect(rows.nth(10).locator('strong')).toHaveText('52m');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const fit = await rows.evaluateAll(nodes => nodes.every(node => {
    const label = node.querySelector('span').getBoundingClientRect();
    const value = node.querySelector('strong').getBoundingClientRect();
    return label.right <= value.left && node.scrollWidth <= node.clientWidth;
  }));
  expect(fit).toBe(true);
  await rows.nth(7).scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('profile-reading-time.png') });
});

test('empty and unavailable session data stay safe on both views', async ({ page }) => {
  await page.goto('/tests/e2e/fixture.html#/book/read-1');
  await page.evaluate(() => window.fixtureRefresh({ readingTimeSessions: [] }));
  await expect(page.locator('.reading-stats-grid > div').nth(4).locator('strong')).toHaveText('00:00:00');
  await expect(page.locator('.reading-stats-grid > div').nth(5).locator('strong')).toHaveText('00:00:00');
  await page.evaluate(() => window.fixtureRefresh({ readingTimeSessions: null }));
  await expect(page.locator('.reading-stats-grid > div').nth(4).locator('strong')).toHaveText('—');
  await page.locator('[data-route="profile"]').first().click();
  await page.getByRole('tab', { name: 'Stats', exact: true }).click();
  await expect(page.locator('.profile-stat-row').last().locator('strong')).toHaveText('—');
  await page.evaluate(() => window.fixtureRefresh({ readingTimeSessions: [] }));
  await expect(page.locator('.profile-stat-row').last().locator('strong')).toHaveText('0m');
});
