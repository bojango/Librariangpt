import { test, expect } from '@playwright/test';

const project = 'fbbpovieqfsjunmqtxvf';
const api = `https://${project}.supabase.co`;

async function plannerApp(page, { refreshFails = false } = {}) {
  const user = { id: '10000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'planner@example.test' };
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${encode({ alg: 'HS256' })}.${encode({ sub: user.id, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.fixture`;
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: `sb-${project}-auth-token`, value: { access_token: token, refresh_token: 'fixture', expires_at: Math.floor(Date.now() / 1000) + 3600, user }
  });
  const books = Array.from({ length: 10 }, (_, i) => ({
    id: `20000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`, title: `Planner book ${i + 1}`, authors: 'Fixture Author',
    overall_status: i === 8 ? 'Wishlist' : 'Owned - Unread', ownership_status: i === 8 ? 'On Order' : 'Owned',
    metadata_status: 'resolved', synopsis: 'Fixture synopsis', total_pages: 240, primary_genre: 'Nonfiction',
    public_rating_5: i === 0 ? 4.2 : null, public_rating_provider: i === 0 ? 'Goodreads' : null
  }));
  let queue = books.slice(0, 8).map((b, i) => ({ ...b, queue_id: `queue-${i + 1}`, position: i + 1,
    source: i === 0 ? 'Manual' : 'AI', locked: i === 0, ai_score: 9.3 - i * .2,
    reason: 'After the current read, this subject follows your temporary interest in a shorter nonfiction book.' }));
  const calls = [];
  await page.route(`${api}/**`, async route => {
    const path = new URL(route.request().url()).pathname;
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (path === '/auth/v1/user') return json(user);
    if (path.endsWith('/v_up_next')) { calls.push({ name: 'queue_read' }); return json(queue); }
    if (path.endsWith('/v_library')) return json(books);
    if (path.includes('/rpc/')) {
      const name = path.split('/').at(-1);
      const args = route.request().postDataJSON();
      calls.push({ name, args });
      if (name === 'refresh_up_next' && refreshFails) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Planner temporarily unavailable' }) });
      if (name === 'up_next_set_locked') queue = queue.map(q => q.queue_id === args.p_queue_id ? { ...q, locked: args.p_locked } : q);
      if (name === 'up_next_reorder') queue = args.p_queue_ids.map((id, i) => ({ ...queue.find(q => q.queue_id === id), position: i + 1 }));
      if (name === 'up_next_remove') {
        queue = queue.filter(q => q.queue_id !== args.p_queue_id);
        queue.push({ ...books[8], queue_id: 'queue-9', source: 'AI', locked: false });
        queue = queue.map((q, i) => ({ ...q, position: i + 1 }));
      }
      if (name === 'up_next_add') queue.push({ ...books.find(b => b.id === args.p_book_id), queue_id: 'queue-10', position: queue.length + 1, locked: true, source: 'Manual' });
      return json({ refreshed: true });
    }
    return json([]);
  });
  await page.goto('/#/home');
  await expect(page.locator('.upnext-card')).toHaveCount(5);
  return { calls, books };
}

test('real app refreshes before queue load, shows five and manages all reserves', async ({ page }) => {
  const { calls } = await plannerApp(page);
  expect(calls.findIndex(c => c.name === 'refresh_up_next')).toBeLessThan(calls.findIndex(c => c.name === 'queue_read'));
  expect(calls.find(c => c.name === 'refresh_up_next').args.p_force).toBe(false);
  await expect(page.getByRole('heading', { name: 'On order', exact: true })).toBeVisible();
  await page.locator('[data-manage-upnext]').click();
  await expect(page.locator('[data-queue-id]')).toHaveCount(8);
  await page.getByRole('button', { name: 'Reconsider unlocked picks' }).click();
  await expect(page.locator('#queue-manager-list')).toHaveCount(0);
  expect(calls.some(c => c.name === 'refresh_up_next' && c.args.p_force === true)).toBe(true);
  await expect(page.locator('.upnext-card').first()).toContainText('locked');
});

test('real manager retains lock, reorder, removal and manual-add RPC paths', async ({ page }) => {
  const { calls, books } = await plannerApp(page);
  await page.locator('[data-manage-upnext]').click();
  await page.locator('[data-queue-id="queue-2"] [data-queue-lock]').click();
  await expect(page.locator('#queue-manager-list')).toHaveCount(0);
  expect(calls.some(c => c.name === 'up_next_set_locked' && c.args.p_locked)).toBe(true);
  await page.locator('[data-manage-upnext]').click();
  await page.locator('[data-queue-id="queue-3"] [data-queue-move="up"]').click();
  await expect(page.locator('#queue-manager-list')).toHaveCount(0);
  expect(calls.find(c => c.name === 'up_next_reorder').args.p_queue_ids).toHaveLength(8);
  await page.locator('[data-manage-upnext]').click();
  await page.locator('[data-queue-id="queue-1"] [data-queue-remove]').click();
  await expect(page.locator('.upnext-card')).toHaveCount(5);
  await expect(page.locator('[data-upnext-id="queue-6"]')).toBeVisible();
  await page.locator('[data-manage-upnext]').click();
  await expect(page.locator('[data-queue-id]')).toHaveCount(8);
  await page.locator('#upnext-add-book').selectOption(books[9].id);
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await expect(page.locator('#queue-manager-list')).toHaveCount(0);
  expect(calls.find(c => c.name === 'up_next_add').args).toMatchObject({ p_source: 'Manual', p_locked: true, p_book_id: books[9].id });
});

test('planner outage preserves existing queue and surfaces explicit refresh errors', async ({ page }) => {
  await plannerApp(page, { refreshFails: true });
  await page.locator('[data-manage-upnext]').click();
  await page.getByRole('button', { name: 'Reconsider unlocked picks' }).click();
  await expect(page.getByText('Planner temporarily unavailable', { exact: true })).toBeVisible();
  await expect(page.locator('[data-queue-id]')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Reconsider unlocked picks' })).toBeEnabled();
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
