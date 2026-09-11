import test from 'node:test';
import assert from 'node:assert/strict';
import {
  excludeSeriesFromAuthor,
  readRelatedCache,
  RELATED_BOOKS_CACHE_MAX_AGE_MS,
  relatedDataFingerprint,
  relatedStatus,
  writeRelatedCache
} from '../../src/utils/related-books.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

test('related status distinguishes read, wishlist, owned and external items', () => {
  assert.equal(relatedStatus({ overall_status: 'Read' }).label, 'Read');
  assert.equal(relatedStatus({ overall_status: 'Wishlist' }).label, 'Wishlist');
  assert.equal(relatedStatus({ ownership_status: 'Owned' }).label, 'Owned');
  assert.equal(relatedStatus({ kind: 'external' }).label, 'Not in your library');
});

test('author shelf excludes books already represented by the series shelf', () => {
  const series = [
    { book_id: 'wool', title: 'Wool' },
    { book_id: 'shift', title: 'Shift' },
    { book_id: 'dust', title: 'Dust' }
  ];
  const author = [
    { book_id: 'wool', title: 'Wool' },
    { book_id: 'beacon', title: 'Beacon 23' },
    { kind: 'external', title: 'Dust' },
    { kind: 'external', title: 'Sand' }
  ];
  assert.deepEqual(excludeSeriesFromAuthor(series, author).map(item => item.title), ['Beacon 23', 'Sand']);
});

test('related-book responses persist in local storage and remain readable across visits', () => {
  const storage = memoryStorage();
  const data = { series: { name: 'Silo', books: [{ title: 'Shift' }] }, author: null };
  assert.equal(writeRelatedCache(storage, 'wool', data, 1_000), true);
  assert.deepEqual(readRelatedCache(storage, 'wool', 5_000), data);
  assert.equal(relatedDataFingerprint(readRelatedCache(storage, 'wool', 5_000)), relatedDataFingerprint(data));
});

test('related-book cache expires after the fallback window', () => {
  const storage = memoryStorage();
  const data = { author: { name: 'Michael Crichton', books: [{ title: 'Sphere' }] } };
  writeRelatedCache(storage, 'jurassic-park', data, 1_000);
  assert.equal(readRelatedCache(storage, 'jurassic-park', 1_000 + RELATED_BOOKS_CACHE_MAX_AGE_MS + 1), null);
});
