import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute, routeHash } from '../../src/router.js';

test('parses top-level routes and falls back safely', () => {
  assert.deepEqual(parseRoute('#/wishlist'), { name: 'wishlist', bookId: null });
  assert.deepEqual(parseRoute('#/unknown'), { name: 'home', bookId: null });
});

test('round-trips book routes without losing identity', () => {
  const route = { name: 'book', bookId: 'book/id 1' };
  assert.deepEqual(parseRoute(routeHash(route)), route);
});
