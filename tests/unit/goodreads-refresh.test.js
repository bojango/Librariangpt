import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GOODREADS_BATCH_SIZE,
  ISBN_CANDIDATE_LIMIT,
  MAX_GOODREADS_BATCH_SIZE,
  TITLE_AUTHOR_CANDIDATE_LIMIT,
  authorSimilarity,
  candidateLimitForQuery,
  extractGoodreadsCandidateUrls,
  goodreadsBookIdentity,
  goodreadsDiscoveryQueries,
  failureStateUpdate,
  normalizeBaseTitle,
  parseGoodreadsJsonLd,
  processSequentially,
  selectDominantExactTitleIdentity,
  shouldRefreshGoodreads,
  successStateUpdate,
  validateGoodreadsCandidate,
  weeklyRefreshCapacity
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

test('ISBN confirmation remains highest confidence and unsafe identity rejects', () => {
  assert.equal(validateGoodreadsCandidate(book, candidate()).tier, 'ISBN_CONFIRMED');
  assert.equal(validateGoodreadsCandidate(book, candidate({ title: 'The Wrong Book' })).matched, false);
  assert.equal(validateGoodreadsCandidate(book, candidate({ authors: ['Someone Else'] })).matched, false);
  assert.equal(validateGoodreadsCandidate({ title: 'The City', author: 'Alex Smith' }, candidate({ title: 'City', authors: ['Alex Smythe'], isbns: [] })).matched, false);
  assert.equal(validateGoodreadsCandidate(
    { title: 'Becoming Martian', author: 'Scott Solomon', isbn13: '9780262051521' },
    candidate({ title: 'Becoming Martian: How Living in Space Will Change Our Bodies and Minds', authors: ['Scott Solomon'], isbns: ['9780262051514'] })
  ).tier, 'WORK_CONFIRMED');
  assert.equal(validateGoodreadsCandidate(book, candidate({ title: 'Dark Matter Study Guide', authors: ['Study Notes'], isbns: ['9780000000000'] })).matched, false);
});

test('same-work edition matching requires exceptionally strong title and primary author', () => {
  const differentEdition = { title: 'Dust (Silo #3)', authors: ['Hugh Howey'], isbns: ['9781804940846'] };
  assert.equal(validateGoodreadsCandidate({ title: 'Dust', author: 'Hugh Howey', isbn13: '9781490904382' }, differentEdition).tier, 'WORK_CONFIRMED');
  assert.equal(validateGoodreadsCandidate({ title: 'Dust', author: 'Another Author', isbn13: '9781490904382' }, differentEdition).matched, false);
  assert.equal(validateGoodreadsCandidate({ title: 'Dust: A Study Guide', author: 'Hugh Howey', isbn13: '9781490904382' }, differentEdition).matched, false);
});

test('title normalization handles subtitles and series without making short titles generic', () => {
  assert.equal(normalizeBaseTitle('Life 3.0: Being Human in the Age of Artificial Intelligence'), 'life 3 0');
  assert.equal(normalizeBaseTitle('Pines (Wayward Pines #1)'), 'pines');
  assert.equal(normalizeBaseTitle('The First Fifteen Lives of Harry August: A Novel'), 'first fifteen lives of harry august');
  assert.equal(normalizeBaseTitle('Influx by Daniel Suarez (2014-02-20)'), 'influx');
  assert.equal(normalizeBaseTitle('Salt: A World History'), 'salt a world history');
});

test('author identity tolerates diacritics, initials and surname-first but not contributors', () => {
  assert.equal(authorSimilarity('Stanisław Lem', ['Stanislaw Lem']), 1);
  assert.equal(authorSimilarity('Michael Crichton', ['Michael J. Crichton']), 0.99);
  assert.equal(authorSimilarity('S. Lem', ['Lem, Stanislaw']), 0.96);
  assert.equal(authorSimilarity('Jon Krakauer', ['Someone Else', 'Jon Krakauer']), 0);
  assert.equal(authorSimilarity('Jon Krakauer', ['Foreword by Jon Krakauer']), 0);
});

test('discovery tries ISBN13, ISBN10, then title and primary author', () => {
  assert.deepEqual(goodreadsDiscoveryQueries({ title: 'Wool', author: 'Hugh Howey', isbn13: '978-1-47-673395-1', isbn10: '1476733953' }), [
    '9781476733951', '1476733953', 'Wool Hugh Howey'
  ]);
});

test('known Goodreads mappings normalize to a direct canonical page', () => {
  assert.deepEqual(goodreadsBookIdentity('https://www.goodreads.com/book/show/13453029-wool'), {
    providerBookId: '13453029', sourceUrl: 'https://www.goodreads.com/book/show/13453029'
  });
  assert.deepEqual(goodreadsBookIdentity('https://www.goodreads.com/en/book/show/234353325-becoming-martian'), {
    providerBookId: '234353325', sourceUrl: 'https://www.goodreads.com/book/show/234353325'
  });
});

test('candidate parsing supports current link forms, deduplicates IDs, and enforces depth', () => {
  const html = `
    <a href="/book/show/123-title">one</a>
    <a href="https://www.goodreads.com/en/book/show/123.duplicate">duplicate</a>
    <script>{"url":"\\u002Fbook\\u002Fshow\\u002F456-slug"}</script>
    <a href="%2Fen%2Fbook%2Fshow%2F789-title">encoded</a>`;
  assert.deepEqual(extractGoodreadsCandidateUrls(html), [
    'https://www.goodreads.com/book/show/123',
    'https://www.goodreads.com/book/show/789',
    'https://www.goodreads.com/book/show/456'
  ]);
  assert.equal(ISBN_CANDIDATE_LIMIT, 3);
  assert.equal(TITLE_AUTHOR_CANDIDATE_LIMIT, 5);
  assert.equal(candidateLimitForQuery('9781101904220'), 3);
  assert.equal(candidateLimitForQuery('Dark Matter Blake Crouch'), 5);
});

test('missing identity can use dominant trusted metadata without overwriting an author', () => {
  const identity = selectDominantExactTitleIdentity({ title: 'The Ghost Map', author: null }, [
    { title: 'The Ghost Map', authors: ['Steven Johnson'], isbn13: '9781594489259', provider: 'Open Library' },
    { title: 'The Ghost Map.', authors: ['Steven Johnson'], isbn10: '1594489254', provider: 'Open Library' },
    { title: 'The Ghost Map', authors: ['Steven Johnson'], provider: 'Open Library' },
    { title: 'The Ghost Map', authors: ['Alan Sklar'], provider: 'Open Library' }
  ]);
  assert.equal(identity.author, 'Steven Johnson');
  assert.equal(selectDominantExactTitleIdentity({ title: 'Contact', author: 'Carl Sagan' }, [{ title: 'Contact', authors: ['Someone Else'] }]), null);
  assert.equal(selectDominantExactTitleIdentity({ title: 'Longitude', author: null }, [
    { title: 'Longitude', authors: ['Dava Sobel'] }, { title: 'Longitude', authors: ['Arnold Wesker'] }
  ]), null);
});

test('refresh state resets on success, backs off on failure, and leaves cached rating untouched', () => {
  const now = Date.parse('2026-09-12T12:00:00Z');
  const cached = Object.freeze({ provider: 'Goodreads', rating_5: 4.13, rating_count: 500000 });
  const failed = failureStateUpdate('book-1', 0, 'HTTP 429', 429, now);
  assert.equal(failed.failure_count, 1);
  assert.equal(failed.next_retry_at, '2026-09-12T18:00:00.000Z');
  assert.equal(failed.last_resolution_tier, 'UNRESOLVED');
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
  assert.equal(DEFAULT_GOODREADS_BATCH_SIZE, 8);
  assert.equal(weeklyRefreshCapacity(), 112);
  assert.ok(weeklyRefreshCapacity() > 80);
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
