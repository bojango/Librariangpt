import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppState } from '../../src/state.js';

function memorySession(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    value: key => values.get(key)
  };
}

test('keeps scroll positions independent by route and persists them for return navigation', () => {
  const session = memorySession();
  globalThis.sessionStorage = session;
  const store = createAppState();

  store.saveScroll('home', 125);
  store.saveScroll('library', 940);
  store.saveScroll('wishlist', 330);

  assert.equal(store.scrollFor('home'), 125);
  assert.equal(store.scrollFor('library'), 940);
  assert.equal(store.scrollFor('wishlist'), 330);
  assert.deepEqual(JSON.parse(session.value('reading-room-scroll-v2')), {
    home: 125,
    library: 940,
    wishlist: 330
  });
});

test('render tokens reject work from a route that is no longer active', () => {
  globalThis.sessionStorage = memorySession();
  const store = createAppState();
  const first = store.beginRender();
  const second = store.beginRender();

  assert.equal(store.isCurrent(first), false);
  assert.equal(store.isCurrent(second), true);
});
