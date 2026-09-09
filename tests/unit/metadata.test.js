import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseProviderId, confidenceRank, convertProgress, mergeTrustedMetadata, selectCoverCandidate, selectPrimaryRating } from '../../src/utils/metadata.js';

test('orders metadata confidence and protects trusted exact identity', () => {
  assert.ok(confidenceRank('user') > confidenceRank('exact'));
  assert.ok(confidenceRank('exact') > confidenceRank('fuzzy'));
  const merged = mergeTrustedMetadata({ isbn13: '9780306406157', title: 'Trusted', _confidence: { isbn13: 'exact', title: 'stored' } }, { isbn13: '9780143127741', title: 'Guess' }, { isbn13: 'fuzzy', title: 'fuzzy' });
  assert.equal(merged.isbn13, '9780306406157');
  assert.equal(merged.title, 'Trusted');
});

test('provider failure cannot erase trusted bibliographic metadata', () => {
  const merged = mergeTrustedMetadata({ title: 'Stored title', publisher: 'Stored publisher' }, { title: null, publisher: '' });
  assert.equal(merged.title, 'Stored title');
  assert.equal(merged.publisher, 'Stored publisher');
});

test('reuses a known provider id before rediscovery', () => {
  assert.equal(chooseProviderId({ google: 'g-123' }, [{ provider: 'google' }, { provider: 'openlibrary' }]), 'g-123');
});

test('ratings remain independent and choose a stable primary source', () => {
  const ratings = [{ provider: 'Google Books', rating_5: 4.1, is_primary: true }, { provider: 'Goodreads', rating_5: 4.3 }];
  assert.equal(selectPrimaryRating(ratings).provider, 'Goodreads');
  assert.equal(mergeTrustedMetadata({ title: 'Book' }, {}).title, 'Book');
});

test('converts reading progress safely when editions change', () => {
  assert.equal(convertProgress(100, 200, 300, 'percentage'), 150);
  assert.equal(convertProgress(250, 300, 200, 'page'), 200);
});

test('cover priority preserves selected and exact owned artwork', () => {
  assert.equal(selectCoverCandidate([{ id: 1, score: 10 }, { id: 2, selected: true }]).id, 2);
  assert.equal(selectCoverCandidate([{ id: 1, exact_edition: false, score: 9 }, { id: 2, exact_edition: true, score: 2 }], { owned: true }).id, 2);
});
