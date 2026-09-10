const SHELL = 'reading-room-shell-v43';
const COVERS = 'reading-room-covers-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest?v=43',
  './src/styles/app.css?v=43',
  './dist/app.js?v=43',
  './dist/app.js.map',
  './supabase-config.js',
  './assets/reading-room-mark.svg',
  './assets/reading-room-app-icon.svg',
  './assets/goodreads.svg',
  './assets/google-books.svg',
  './assets/open-library.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => (key.startsWith('reading-room-shell-') && key !== SHELL)
      || (key.startsWith('reading-room-covers-') && key !== COVERS)
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
  if (url.hostname.endsWith('.supabase.co')) {
    try {
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
      return response;
    } catch { return cached || new Response('', { status: 504 }); }
  }
  const update = fetch(request).then(async response => {
    if (response.ok || response.type === 'opaque') await cache.put(request, response.clone());
    return response;
  });
  return cached || update.catch(() => new Response('', { status: 504 }));
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);

  // Canonical Supabase API and function responses always stay on the network.
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
