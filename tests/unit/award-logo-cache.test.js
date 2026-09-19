import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const workerSource = await readFile('sw.js', 'utf8');

function createHarness(initialNetwork) {
  const listeners = {};
  const stores = new Map();
  let network = initialNetwork;
  const keyFor = request => typeof request === 'string' ? request : request.url;
  const cacheFor = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      async match(request) { return store.get(keyFor(request))?.clone(); },
      async put(request, response) { store.set(keyFor(request), response.clone()); },
      async addAll() {}
    };
  };
  const caches = {
    open: async name => cacheFor(name),
    keys: async () => [...stores.keys()],
    delete: async name => stores.delete(name)
  };
  const self = {
    location: { origin: 'https://reading-room.test' },
    clients: { claim() {} },
    skipWaiting() {},
    addEventListener(type, listener) { listeners[type] = listener; }
  };
  vm.runInNewContext(workerSource, {
    self,
    caches,
    fetch: request => network(request),
    URL,
    Response,
    Promise,
    console
  });

  async function fetchEvent(url, destination = 'image') {
    let responsePromise;
    const waits = [];
    const request = { url, method: 'GET', destination, mode: 'cors' };
    listeners.fetch({
      request,
      respondWith(value) { responsePromise = Promise.resolve(value); },
      waitUntil(value) { waits.push(Promise.resolve(value)); }
    });
    return { request, response: await responsePromise, waits };
  }

  return {
    stores,
    cacheFor,
    fetchEvent,
    setNetwork(next) { network = next; },
    diagnosticState() {
      let state;
      listeners.message({ data: { type: 'SET_DIAGNOSTICS', enabled: true } });
      listeners.message({ data: { type: 'GET_DIAGNOSTIC_STATE' }, ports: [{ postMessage(value) { state = value; } }] });
      return state;
    },
    async activate() {
      const waits = [];
      listeners.activate({ waitUntil(value) { waits.push(Promise.resolve(value)); } });
      await Promise.all(waits);
    }
  };
}

const awardUrl = 'https://fbbpovieqfsjunmqtxvf.supabase.co/storage/v1/object/public/award-logos/hugo-award-v1.webp';

test('first award-logo request fetches and caches, then repeat returns cache immediately', async () => {
  let fetches = 0;
  const harness = createHarness(async () => new Response(`network-${++fetches}`, { status: 200, headers: { 'content-type': 'image/webp' } }));
  harness.diagnosticState();

  const first = await harness.fetchEvent(awardUrl);
  assert.equal(await first.response.text(), 'network-1');
  assert.ok(harness.stores.get('reading-room-award-logos-v1')?.has(awardUrl));

  let release;
  harness.setNetwork(() => new Promise(resolve => { release = resolve; }));
  const second = await harness.fetchEvent(awardUrl);
  assert.equal(await second.response.text(), 'network-1');
  release(new Response('network-2', { status: 200 }));
  await Promise.all(second.waits);

  const state = harness.diagnosticState();
  assert.equal(state.award_logo_cache_hits, 1);
  assert.equal(state.award_logo_cache_misses, 1);
  assert.equal(state.award_logo_network_fetches, 2);
});

test('temporary award-logo network failure uses the cached response', async () => {
  const harness = createHarness(async () => new Response('cached-award', { status: 200 }));
  await harness.fetchEvent(awardUrl);
  harness.setNetwork(async () => { throw new Error('offline'); });
  const repeat = await harness.fetchEvent(awardUrl);
  assert.equal(await repeat.response.text(), 'cached-award');
  await Promise.all(repeat.waits);
});

test('award cache lifecycle is independent of shell releases and removes only obsolete award versions', async () => {
  const harness = createHarness(async () => new Response('unused'));
  await Promise.all([
    harness.cacheFor('reading-room-shell-v65').put('old-shell', new Response('x')),
    harness.cacheFor('reading-room-shell-v76').put('shell', new Response('x')),
    harness.cacheFor('reading-room-covers-v3').put('cover', new Response('x')),
    harness.cacheFor('reading-room-award-logos-v0').put('old-award', new Response('x')),
    harness.cacheFor('reading-room-award-logos-v1').put(awardUrl, new Response('award'))
  ]);
  await harness.activate();
  assert.deepEqual([...harness.stores.keys()].sort(), [
    'reading-room-award-logos-v1',
    'reading-room-covers-v3',
    'reading-room-shell-v76'
  ]);
});

test('ordinary Supabase book covers keep their existing network-first behaviour', async () => {
  const coverUrl = 'https://fbbpovieqfsjunmqtxvf.supabase.co/storage/v1/object/public/book-covers/cover.webp';
  const harness = createHarness(async () => new Response('fresh-cover', { status: 200 }));
  await harness.cacheFor('reading-room-covers-v3').put(coverUrl, new Response('cached-cover'));
  const result = await harness.fetchEvent(coverUrl);
  assert.equal(await result.response.text(), 'fresh-cover');
  assert.equal(await (await harness.cacheFor('reading-room-covers-v3').match(coverUrl)).text(), 'fresh-cover');
  assert.equal(harness.stores.get('reading-room-award-logos-v1'), undefined);
});
