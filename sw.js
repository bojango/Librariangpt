const GENERATION = '77';
const SHELL = `reading-room-shell-v${GENERATION}`;
const COVERS = 'reading-room-covers-v3';
const AWARD_LOGOS = 'reading-room-award-logos-v1';
const APP_SHELL = [
  './',
  './index.html',
  `./manifest.webmanifest?v=${GENERATION}`,
  `./src/styles/app.css?v=${GENERATION}`,
  `./dist/app.js?v=${GENERATION}`,
  './dist/app.js.map',
  './supabase-config.js',
  './assets/reading-room-mark.svg',
  './assets/reading-room-app-icon.svg',
  './assets/goodreads.svg',
  './assets/google-books.svg',
  './assets/open-library.svg',
  './assets/fonts/jetbrains-mono-regular.ttf',
  './assets/fonts/jetbrains-mono-semibold.ttf',
  './assets/fonts/commit-mono-regular.woff2',
  './assets/fonts/commit-mono-semibold.woff2',
  './assets/fonts/ibm-plex-mono-regular.woff2',
  './assets/fonts/ibm-plex-mono-semibold.woff2',
  './assets/fonts/space-mono-regular.woff2',
  './assets/fonts/space-mono-bold.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
let diagnosticsEnabled = false;
const diagnosticCounters = {
  cover_cache_hits: 0,
  cover_cache_misses: 0,
  cover_network_fetches: 0,
  award_logo_cache_hits: 0,
  award_logo_cache_misses: 0,
  award_logo_network_fetches: 0
};

self.addEventListener('message', event => {
  if (event.data?.type === 'SET_DIAGNOSTICS') {
    const next = event.data.enabled === true;
    if (next && !diagnosticsEnabled) Object.keys(diagnosticCounters).forEach(key => { diagnosticCounters[key] = 0; });
    diagnosticsEnabled = next;
    return;
  }
  if (event.data?.type === 'GET_DIAGNOSTIC_STATE') {
    event.ports?.[0]?.postMessage({ generation: GENERATION, shell_cache: SHELL, cover_cache: COVERS, award_logo_cache: AWARD_LOGOS, ...diagnosticCounters });
  }
});

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => (key.startsWith('reading-room-shell-') && key !== SHELL)
      || (key.startsWith('reading-room-covers-') && key !== COVERS)
      || (key.startsWith('reading-room-award-logos-') && key !== AWARD_LOGOS)
      || key.startsWith('librariangpt-shell-')
      || key.startsWith('librariangpt-covers-')
      || key.startsWith('librariangpt-data-'))
    .map(key => caches.delete(key)))));
  self.clients.claim();
});

function isCover(url, request) {
  return request.destination === 'image' && (url.hostname === 'covers.openlibrary.org'
    || url.hostname.endsWith('googleusercontent.com')
    || url.hostname === 'books.google.com'
    || url.hostname.endsWith('.supabase.co'));
}

function isAwardLogo(url, request) {
  return (request.destination === 'image' || request.destination === '')
    && url.hostname.endsWith('.supabase.co')
    && url.pathname.startsWith('/storage/v1/object/public/award-logos/');
}

async function networkFirst(request, fallback = './index.html') {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match(fallback)) || new Response('Offline', { status: 503 });
  }
}

async function staleCover(request) {
  const url = new URL(request.url);
  const cache = await caches.open(COVERS);
  const cached = await cache.match(request);
  if (diagnosticsEnabled) diagnosticCounters[cached ? 'cover_cache_hits' : 'cover_cache_misses'] += 1;
  if (url.hostname.endsWith('.supabase.co')) {
    try {
      if (diagnosticsEnabled) diagnosticCounters.cover_network_fetches += 1;
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
      return response;
    } catch { return cached || new Response('', { status: 504 }); }
  }
  if (diagnosticsEnabled) diagnosticCounters.cover_network_fetches += 1;
  const update = fetch(request).then(async response => {
    if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
    return response;
  });
  return cached || update.catch(() => new Response('', { status: 504 }));
}

async function staleAwardLogo(request, event) {
  const cache = await caches.open(AWARD_LOGOS);
  const cached = await cache.match(request);
  if (diagnosticsEnabled) diagnosticCounters[cached ? 'award_logo_cache_hits' : 'award_logo_cache_misses'] += 1;
  const update = (async () => {
    if (diagnosticsEnabled) diagnosticCounters.award_logo_network_fetches += 1;
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
    return response;
  })();
  if (cached) {
    event?.waitUntil(update.catch(() => undefined));
    return cached;
  }
  return update.catch(() => new Response('', { status: 504 }));
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  if (isAwardLogo(url, event.request)) {
    event.respondWith(staleAwardLogo(event.request, event));
    return;
  }

  if (url.hostname.endsWith('.supabase.co') && !isCover(url, event.request)) return;

  if (isCover(url, event.request)) {
    event.respondWith(staleCover(event.request));
    return;
  }

  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(caches.open(SHELL).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch { return new Response('Offline', { status: 503 }); }
  }));
});
