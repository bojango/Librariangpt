import { test, expect } from '@playwright/test';

const project = 'fbbpovieqfsjunmqtxvf';
const api = `https://${project}.supabase.co`;

async function plannerApp(page, { refreshFails = false, theme = 'reading-room', hash = '/#/home' } = {}) {
  const user = { id: '10000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'planner@example.test' };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`;
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: `sb-${project}-auth-token`, value: { access_token: token, refresh_token: 'fixture', expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  });
  await page.addInitScript(value => {
    localStorage.setItem('reading-room-theme', value);
    if (value === 'terminal') {
      const appearance = { bg: '#151619', surface: '#1c1e22', surfaceAlt: '#30343b', text: '#f1eee5', muted: '#d3d1cd', border: '#777a81' };
      localStorage.setItem('reading-room-ui-preferences-v1', JSON.stringify({ selectedTheme: value, appearanceOverrides: { [value]: appearance } }));
    }
  }, theme);
  const books = Array.from({ length: 10 }, (_, i) => ({
    id: `20000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, title: `Planner book ${i + 1}`, authors: 'Fixture Author',
    overall_status: i === 8 ? 'Wishlist' : 'Owned - Unread', ownership_status: i === 8 ? 'On Order' : 'Owned',
    metadata_status: 'resolved', synopsis: 'Fixture synopsis', total_pages: 240, primary_genre: 'Nonfiction',
    fiction_nonfiction: 'Nonfiction', edition_year: 2024, original_publication_year: i === 0 ? 2017 : null,
    cover_url: i === 0 ? '/assets/reading-room-logo.png' : null,
    current_edition_id: i === 0 ? 'latest-edition' : null,
    public_rating_5: i === 0 ? 4.2 : null, public_rating_provider: i === 0 ? 'Goodreads' : null
  }));
  let queue = books.slice(0, 8).map((b, i) => ({ ...b, queue_id: `queue-${i + 1}`, position: i + 1,
    source: i === 0 ? 'Manual' : 'AI', locked: i === 0, ai_score: 9.3 - i * .2,
    reason: 'After the current read, this subject follows your temporary interest in a shorter nonfiction book.' }));
  const calls = [];
  const gates = { edit: null, queueRead: null };
  let failNextEdit = false;
  const hold = key => {
    let release;
    gates[key] = new Promise(resolve => { release = resolve; });
    return release;
  };
  await page.route(`${api}/**`, async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/auth/v1/user') return json(user);
    if (path.endsWith('/v_up_next')) {
      const captured = queue;
      calls.push({ name: 'queue_read' });
      const gate = gates.queueRead;
      gates.queueRead = null;
      await gate;
      return json(captured);
    }
    if (path.endsWith('/v_library')) {
      const id = url.searchParams.get('id')?.slice(3);
      calls.push({ name: id ? 'book_read' : 'library_read' });
      return json(id ? books.find(book => book.id === id) : books);
    }
    if (path.endsWith('/reading_sessions') && url.searchParams.get('status') === 'eq.Completed') {
      return json([
        { id: 'reread', book_id: books[0].id, edition_id: 'latest-edition', total_pages: 410, started_at: '2026-10-01', completed_at: '2026-10-10', user_rating_5: 4.7 },
        { id: 'first', book_id: books[0].id, edition_id: 'old-edition', edition: { book_id: books[0].id, page_count: 326, page_count_verified: true }, started_at: '2025-10-01', completed_at: '2025-10-10', user_rating_5: 4.8 },
        { id: 'unknown', book_id: books[0].id, edition_id: 'missing-edition', started_at: '2024-10-01', completed_at: '2024-10-10' }
      ]);
    }
    if (path.includes('/rpc/')) {
      const name = path.split('/').at(-1);
      const args = route.request().postDataJSON();
      calls.push({ name, args });
      if (name === 'refresh_up_next' && refreshFails) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Planner temporarily unavailable' }) });
      if (name === 'edit_up_next') {
        const { p_action: action, p_args: edit } = args;
        const gate = gates.edit;
        gates.edit = null;
        await gate;
        if (failNextEdit || (action === 'refresh' && refreshFails)) {
          failNextEdit = false;
          return json({ message: 'Planner temporarily unavailable', code: '57014' }, 503);
        }
        if (action === 'lock') queue = queue.map(q => q.queue_id === edit.queue_id ? { ...q, locked: edit.locked } : q);
        if (action === 'reorder') {
          queue = edit.queue_ids.map((id, i) => {
            const item = queue.find(q => q.queue_id === id);
            return item.position === i + 1 ? item : { ...item, position: i + 1, locked: true, source: 'Manual' };
          });
        }
        if (action === 'remove') {
          queue = [...queue.filter(q => q.queue_id !== edit.queue_id), { ...books[8], queue_id: 'queue-9', source: 'AI', locked: false }];
          queue = queue.map((q, i) => ({ ...q, position: i + 1 }));
        }
        if (action === 'add' || action === 'add_first') {
          const existing = queue.find(q => q.id === edit.book_id);
          const book = books.find(b => b.id === edit.book_id);
          const item = { ...(existing || book), queue_id: existing?.queue_id || `queue-${books.indexOf(book) + 1}`,
            position: queue.length + 1, locked: true, source: 'Manual', reason: 'Added manually from Library.' };
          const remaining = queue.filter(q => q.id !== item.id);
          queue = (action === 'add_first' ? [item, ...remaining] : [...remaining, item]).map((q, i) => ({ ...q, position: i + 1 }));
        }
        return json(queue);
      }
      return json({ refreshed: true });
    }
    return json([]);
  });
  await page.goto(hash);
  if (hash === '/#/home') await expect(page.locator('.upnext-card')).toHaveCount(5);
  return { calls, books, hold, fail: () => { failNextEdit = true; } };
}

test('real app refreshes before queue load, shows five and manages all reserves', async ({ page }) => {
  const { calls } = await plannerApp(page);
  expect(calls.findIndex(c => c.name === 'refresh_up_next')).toBeLessThan(calls.findIndex(c => c.name === 'queue_read'));
  expect(calls.find(c => c.name === 'refresh_up_next').args.p_force).toBe(false);
  await expect(page.getByRole('heading', { name: 'On order', exact: true })).toBeVisible();
  await page.locator('[data-manage-upnext]').click();
  await expect(page.locator('[data-queue-id]')).toHaveCount(8);
  await page.getByRole('button', { name: 'Reconsider unlocked picks' }).click();
  await expect(page.getByRole('dialog')).toHaveAttribute('aria-busy', 'false');
  expect(calls.some(c => c.name === 'edit_up_next' && c.args.p_action === 'refresh')).toBe(true);
  await expect(page.locator('.upnext-card').first()).toContainText('locked');
});

test('real manager reorders, locks, unlocks, adds and removes in one modal', async ({ page }, testInfo) => {
  const { calls, books } = await plannerApp(page);
  const currentHeading = await page.locator('#app main > :first-child').elementHandle();
  const cover = await page.locator('[data-upnext-id="queue-1"] .cover-image').elementHandle();
  await page.locator('[data-manage-upnext]').click();
  const dialog = page.getByRole('dialog');
  const row2 = dialog.locator('[data-queue-id="queue-2"]');
  await row2.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(row2.getByRole('button', { name: 'Unlock', exact: true })).toBeEnabled();
  await row2.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(row2.getByRole('button', { name: 'Lock', exact: true })).toBeEnabled();
  const reorderRow = dialog.locator('[data-queue-id="queue-7"]');
  const up = reorderRow.getByRole('button', { name: 'Move up' });
  await up.scrollIntoViewIfNeeded();
  const scroll = await dialog.evaluate(node => node.scrollTop);
  for (const position of [6, 5]) {
    await up.click();
    await expect(dialog).toHaveAttribute('aria-busy', 'false');
    await expect(reorderRow.locator('.queue-manager-order')).toHaveText(String(position));
    expect(await dialog.evaluate(node => node.scrollTop)).toBe(scroll);
  }
  expect(calls.find(c => c.args?.p_action === 'reorder').args.p_args.queue_ids).toHaveLength(8);
  await expect(page.locator('[data-upnext-id="queue-7"]')).toBeVisible();
  expect(await cover.evaluate(node => node.isConnected)).toBe(true);
  await page.locator('[data-queue-id="queue-1"] [data-queue-remove]').click();
  await expect(dialog).toHaveAttribute('aria-busy', 'false');
  await expect(dialog.locator('[data-queue-id="queue-9"]')).toHaveCount(1);
  const selector = page.locator('#upnext-add-book');
  await expect(selector.locator(`option[value="${books[0].id}"]`)).toHaveCount(1);
  await selector.selectOption(books[9].id);
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect(dialog).toHaveAttribute('aria-busy', 'false');
  await expect(dialog.locator('[data-queue-id="queue-10"]')).toContainText('Your pick · locked');
  await expect(selector.locator(`option[value="${books[9].id}"]`)).toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('position 9');
  expect(calls.filter(c => c.name === 'library_read' || c.name === 'queue_read')).toHaveLength(2);
  expect(await currentHeading.evaluate(node => node.isConnected)).toBe(true);
  await dialog.getByRole('button', { name: 'Done' }).scrollIntoViewIfNeeded();
  await page.screenshot({ animations: 'disabled', path: `output/playwright/queue-history/${testInfo.project.name}-queue-manager.png` });
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
});

test('planner outage preserves existing queue and surfaces explicit refresh errors', async ({ page }) => {
  await plannerApp(page, { refreshFails: true });
  await page.locator('[data-manage-upnext]').click();
  await page.getByRole('button', { name: 'Reconsider unlocked picks' }).click();
  await expect(page.locator('#toast')).toContainText('Could not update Up Next');
  await expect(page.locator('[data-queue-id]')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Reconsider unlocked picks' })).toBeEnabled();
});

test('a slow edit rolls back on failure and ignores a stale snapshot during the next reorder', async ({ page }) => {
  const { calls, fail, hold } = await plannerApp(page);
  await page.locator('[data-manage-upnext]').click();
  const dialog = page.getByRole('dialog');
  const first = dialog.locator('[data-queue-id]').first();
  const up = dialog.locator('[data-queue-id="queue-2"]').getByRole('button', { name: 'Move up' });
  const releaseFailure = hold('edit');
  fail();
  await up.click();
  await expect(first).toHaveAttribute('data-queue-id', 'queue-2');
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect.poll(() => calls.filter(c => c.name === 'edit_up_next').length).toBe(1);
  await dialog.locator('[data-queue-id="queue-1"] [data-queue-remove]').dispatchEvent('click');
  expect(calls.filter(c => c.name === 'edit_up_next')).toHaveLength(1);
  releaseFailure();
  await expect(page.locator('#toast')).toContainText('Could not update Up Next');
  await expect(first).toHaveAttribute('data-queue-id', 'queue-1');
  await expect(up).toBeEnabled();
  await expect.poll(() => calls.filter(c => c.name === 'queue_read').length).toBe(2);

  const releaseSnapshot = hold('queueRead');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('reading-room:refresh', { detail: { quiet: true } })));
  await expect.poll(() => calls.filter(c => c.name === 'queue_read').length).toBe(3);
  await up.click();
  await expect(dialog).toHaveAttribute('aria-busy', 'false');
  await expect(first).toHaveAttribute('data-queue-id', 'queue-2');
  const read = page.waitForResponse(response => response.url().includes('/v_up_next'));
  releaseSnapshot();
  await read;
  await expect.poll(() => calls.filter(c => c.name === 'queue_read').length).toBe(4);
  await expect(first).toHaveAttribute('data-queue-id', 'queue-2');
  await expect(page.locator('.upnext-card').first()).toHaveAttribute('data-upnext-id', 'queue-2');
});

for (const theme of ['reading-room', 'terminal']) {
  test(`${theme} book action promotes once per request and updates Home immediately`, async ({ page }, testInfo) => {
    const { calls, books, hold } = await plannerApp(page, { theme });
    const book = books[1];
    await page.evaluate(id => { location.hash = `#/book/${id}`; }, book.id);
    await expect(page.locator('.detail-copy > .eyebrow').first()).toHaveText('Nonfiction');
    const start = page.getByRole('button', { name: 'Start reading' });
    const add = page.getByRole('button', { name: 'Add to Up Next' });
    await expect(add).toBeVisible();
    const geometry = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      const style = selector => {
        const css = getComputedStyle(document.querySelector(selector));
        return { font: css.font, radius: css.borderRadius, foreground: css.color, background: css.backgroundColor };
      };
      return { start: rect('[data-start]'), add: rect('[data-add-up-next]'), first: style('[data-start]'), second: style('[data-add-up-next]') };
    });
    expect(geometry.start.right).toBeLessThan(geometry.add.left);
    expect(geometry.start.width).toBeCloseTo(geometry.add.width, 0);
    expect(geometry.start.height).toBeCloseTo(geometry.add.height, 0);
    expect(geometry.first.font).toBe(geometry.second.font);
    expect(geometry.first.radius).toBe(geometry.second.radius);
    expect(geometry.first.background).not.toBe(geometry.second.background);
    if (theme === 'terminal') {
      expect(geometry.second.background).toBe('rgb(48, 52, 59)');
      expect(geometry.second.foreground).toBe('rgb(241, 238, 229)');
    }
    await expect(start).toBeEnabled();
    const release = hold('edit');
    await add.click();
    const pending = page.getByRole('button', { name: 'Adding…' });
    await expect(pending).toBeDisabled();
    await expect.poll(() => calls.filter(c => c.name === 'edit_up_next').length).toBe(1);
    await pending.dispatchEvent('click');
    expect(calls.filter(c => c.name === 'edit_up_next')).toHaveLength(1);
    await page.locator('.bottom-nav [data-route="home"]').click();
    await expect(page.locator('.upnext-card').first()).toContainText(book.title);
    release();
    await expect(page.locator('#toast')).toContainText('position 1');
    await expect(page.locator('.upnext-card').first()).toContainText('Your pick · locked');
    await expect(page.locator(`[data-upnext-id="queue-2"]`)).toHaveCount(1);
    expect(calls.filter(c => c.name === 'library_read' || c.name === 'queue_read')).toHaveLength(2);
    await page.evaluate(id => { location.hash = `#/book/${id}`; }, books[0].id);
    await expect(page.locator('.detail-copy > .eyebrow').first()).toHaveText('Nonfiction • 2017');
    await add.evaluate(button => button.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await expect(add).toBeInViewport();
    await page.screenshot({ animations: 'disabled', style: '#toast { visibility: hidden; }',
      path: `output/playwright/queue-history/${testInfo.project.name}-${theme}-book.png` });
  });
}

test('History displays the correct count for each completed edition and omits missing counts', async ({ page }, testInfo) => {
  await plannerApp(page);
  await page.locator('.bottom-nav [data-route="profile"]').click();
  await page.getByRole('tab', { name: 'History' }).click();
  const history = page.getByRole('tabpanel', { name: 'History' });
  await expect(history.locator('.profile-history-details')).toHaveText([
    /4\.7\/5 · 410 pages$/, /4\.8\/5 · 326 pages$/, /Unrated$/
  ]);
  await page.screenshot({ animations: 'disabled', path: `output/playwright/queue-history/${testInfo.project.name}-history.png`, fullPage: true });
});

test('Up Next cards and modal show compact decision metadata without missing ratings', async ({ page }) => {
  await plannerApp(page);
  const first = page.locator('.upnext-card').first();
  await expect(first.locator('.upnext-fact')).toHaveCount(4);
  await expect(first).toContainText('240 pages');
  await expect(first).toContainText('Owned');
  await expect(first).toContainText('9.3/10');
  await expect(first.locator('[title="Goodreads rating"]')).toContainText('4.2');
  await expect(page.locator('.upnext-card').nth(1).locator('.upnext-fact')).toHaveCount(3);
  await first.click();
  const modal = page.locator('.upnext-detail-backdrop .modal');
  await expect(modal.locator('.upnext-fact')).toHaveCount(4);
  await expect(modal).toContainText('4.2 Goodreads');
  await expect(modal.getByRole('button', { name: 'Read now' })).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Open book' })).toBeVisible();
});

test('Up Next metadata fits the mobile card and modal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await plannerApp(page);
  const first = page.locator('.upnext-card').first();
  await expect(first.locator('.upnext-fact')).toHaveCount(4);
  const cardBox = await first.boundingBox();
  expect(cardBox.width).toBeLessThan(390);
  await first.click();
  const modal = page.locator('.upnext-detail-backdrop .modal');
  await expect(modal.locator('.upnext-fact')).toHaveCount(4);
  const modalBox = await modal.boundingBox();
  expect(modalBox.width).toBeLessThan(390);
  expect(modalBox.height).toBeLessThan(844);
});
