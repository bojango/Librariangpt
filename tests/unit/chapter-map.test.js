import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTER_MAP_FAILED_COOLDOWN_MS, CHAPTER_MAP_NOT_FOUND_COOLDOWN_MS, maybeMapCurrentChapters, shouldMapCurrentChapters } from '../../src/features/chapter-map.js';

const now = Date.parse('2026-09-13T12:00:00Z');
const row = overrides => ({ id: 'book-1', overall_status: 'Currently Reading', display_edition_id: 'edition-1', ...overrides });

test('unattempted current-reading edition is eligible for chapter mapping', () => {
  assert.equal(shouldMapCurrentChapters(row({}), now), true);
  assert.equal(shouldMapCurrentChapters(row({ has_chapter_map: true }), now), false);
});

test('recent not_found and transient failures respect their cooldowns', () => {
  assert.equal(shouldMapCurrentChapters(row({ chapter_map_status: 'not_found', chapter_map_last_checked_at: new Date(now - CHAPTER_MAP_NOT_FOUND_COOLDOWN_MS + 1).toISOString() }), now), false);
  assert.equal(shouldMapCurrentChapters(row({ chapter_map_status: 'not_found', chapter_map_last_checked_at: new Date(now - CHAPTER_MAP_NOT_FOUND_COOLDOWN_MS).toISOString() }), now), true);
  assert.equal(shouldMapCurrentChapters(row({ chapter_map_status: 'failed', chapter_map_last_checked_at: new Date(now - CHAPTER_MAP_FAILED_COOLDOWN_MS + 1).toISOString() }), now), false);
  assert.equal(shouldMapCurrentChapters(row({ chapter_map_status: 'failed', chapter_map_last_checked_at: new Date(now - CHAPTER_MAP_FAILED_COOLDOWN_MS).toISOString() }), now), true);
});

test('successful background chapter mapping refreshes once and is session-deduped', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  let calls = 0;
  let refreshes = 0;
  const snapshot = { books: [{ id: 'book-1', overall_status: 'Currently Reading' }], chapters: [row({})] };
  const options = { storage, now, invoke: async () => { calls += 1; return { ok: true, imported: 8 }; }, refresh: async () => { refreshes += 1; } };
  assert.deepEqual(await maybeMapCurrentChapters(snapshot, options), { attempted: 1, imported: 8 });
  assert.deepEqual(await maybeMapCurrentChapters(snapshot, options), { attempted: 0, imported: 0 });
  assert.equal(calls, 1);
  assert.equal(refreshes, 1);
});
