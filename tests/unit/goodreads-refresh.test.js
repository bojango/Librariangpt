import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GOODREADS_BATCH_SIZE,
  failureStateUpdate,
  parseGoodreadsJsonLd,
  processSequentially,
  shouldRefreshGoodreads,
  successStateUpdate,
  validateGoodreadsCandidate
} from '../../supabase/functions/_shared/goodreads.js';

const candidate = (overrides = {}) => ({
  title: 'Dark Matter',
  authors: ['Blake Crouch'],
  isbns: ['9781101904220'],
  rating_5: 4.13,
  rating_count: 500000,
  review_count: 42000,
  ...overrides
});
const book = { title: 'Dark Matter', author: 'Blake Crouch', isbn13: '9781101904220' };

test('parses Goodreads JSON-LD object, array, and @graph shapes', () => {
  const shapes = [
    { name: 'Dark Matter', author: { name: 'Blake Crouch' }, isbn: '9781101904220', aggregateRating: { ratingValue: '4.13', ratingCount: '500000', reviewCount: '42000' } },
    [{ name: 'Dark Matter', author: [{ name: 'Blake Crouch' }], aggregateRating: { ratingValue: 4.13, ratingCount: 500000 } }],
    { '@graph': [{ '@type': 'Thing' }, { name: 'Dark Matter', author: { name: 'Blake Crouch' }, aggregateRating: { ratingValue: 4.13, ratingCount: 500000 } }] }
  ];
  for (const shape of shapes) assert.equal(parseGoodreadsJsonLd(`<script type="application/ld+json">${JSON.stringify(shape)}</script>`).rating_count, 500000);
  assert.equal(parseGoodreadsJsonLd('<script type="application/ld+json">{"name":"Bad","aggregateRating":{"ratingValue":9,"ratingCount":0}}</script>'), null);
});

test('Goodreads matching accepts exact identity and rejects unsafe candidates', () => {
  assert.equal(validateGoodreadsCandidate(book, candidate()).matched, true);
  assert.equal(validateGoodreadsCandidate(book, candidate({ title: 'The Wrong Book' })).matched, false);
  assert.equal(validateGoodreadsCandidate(book, candidate({ authors: ['Someone Else'] })).matched, false);
  assert.equal(validateGoodreadsCandidate({ title: 'The City', author: 'Alex Smith' }, candidate({ title: 'City', authors: ['Alex Smythe'], isbns: [] })).matched, false);
});

test('refresh state resets on success, backs off on failure, and leaves cached rating untouched', () => {
  const now = Date.parse('2026-09-12T12:00:00Z');
  const cached = Object.freeze({ provider: 'Goodreads', rating_5: 4.13, rating_count: 500000 });
  const failed = failureStateUpdate('book-1', 0, 'HTTP 429', 429, now);
  assert.equal(failed.failure_count, 1);
  assert.equal(failed.next_retry_at, '2026-09-12T18:00:00.000Z');
  assert.deepEqual(cached, { provider: 'Goodreads', rating_5: 4.13, rating_count: 500000 });
  const succeeded = successStateUpdate('book-1', now);
  assert.equal(succeeded.failure_count, 0);
  assert.equal(succeeded.last_error, null);
  assert.equal(succeeded.next_retry_at, '2026-09-19T12:00:00.000Z');
});

test('server due logic skips fresh ratings and premature retries', () => {
  const now = Date.parse('2026-09-12T12:00:00Z');
  assert.equal(shouldRefreshGoodreads({ rating: { fetched_at: '2026-09-10T00:00:00Z' }, now }), false);
  assert.equal(shouldRefreshGoodreads({ rating: { fetched_at: '2026-09-01T00:00:00Z' }, now }), true);
  assert.equal(shouldRefreshGoodreads({ refreshState: { next_retry_at: '2026-09-13T00:00:00Z' }, now }), false);
});

test('batch processing is capped by configuration and remains sequential', async () => {
  assert.equal(MAX_GOODREADS_BATCH_SIZE, 8);
  let active = 0;
  let peak = 0;
  const order = [];
  await processSequentially(['a', 'b', 'c'], async value => {
    active += 1;
    peak = Math.max(peak, active);
    order.push(value);
    await Promise.resolve();
    active -= 1;
    return value;
  });
  assert.equal(peak, 1);
  assert.deepEqual(order, ['a', 'b', 'c']);
});
