import test from 'node:test';
import assert from 'node:assert/strict';
import { detailFingerprint, routeKey, sameRoute, snapshotFingerprint } from '../../src/lifecycle.js';

test('distinguishes route identity from same-route data refreshes', () => {
  assert.equal(sameRoute({ name: 'home' }, { name: 'home' }), true);
  assert.equal(sameRoute({ name: 'book', bookId: 'a' }, { name: 'book', bookId: 'a', returnTo: 'home' }), true);
  assert.equal(sameRoute({ name: 'book', bookId: 'a' }, { name: 'book', bookId: 'b' }), false);
  assert.equal(routeKey({ name: 'library' }), 'library');
});

test('snapshot comparison ignores route and viewport state but detects data changes', () => {
  const initial = { books: [{ id: '1', title: 'A' }], upNext: [], recommendations: [], aiRecommendations: [], chapters: [], route: { name: 'home' }, scroll: { home: 900 } };
  const viewportOnly = { ...initial, route: { name: 'library' }, scroll: { home: 0 } };
  const changed = { ...initial, books: [{ id: '1', title: 'Updated' }] };
  assert.equal(snapshotFingerprint(initial), snapshotFingerprint(viewportOnly));
  assert.notEqual(snapshotFingerprint(initial), snapshotFingerprint(changed));
});

test('detail comparison detects edition mutations without changing route identity', () => {
  const before = { book: { id: '1', current_edition_id: 'old' }, editions: [] };
  const after = { book: { id: '1', current_edition_id: 'new' }, editions: [] };
  assert.notEqual(detailFingerprint(before), detailFingerprint(after));
});
