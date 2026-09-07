(() => {
  const CACHE_NAME = 'librariangpt-data-v2';
  const nativeFetch = window.fetch.bind(window);
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;

  const isSupabaseRest = url => {
    try {
      const u = new URL(typeof url === 'string' ? url : url.url);
      return u.hostname.endsWith('.supabase.co') && u.pathname.startsWith('/rest/v1/');
    } catch { return false; }
  };

  function ttlFor(request) {
    const u = new URL(request.url);
    const path = u.pathname;
    if (path.includes('/v_library')) return 12 * HOUR;
    if (path.includes('/recommendations')) return 24 * HOUR;
    if (path.includes('/public_ratings')) return 7 * 24 * HOUR;
    if (path.includes('/book_cover_candidates')) return 30 * 24 * HOUR;
    if (path.includes('/books') || path.includes('/editions') || path.includes('/authors') || path.includes('/series')) return 24 * HOUR;
    return 2 * HOUR;
  }

  async function clear() {
    try { await caches.delete(CACHE_NAME); } catch {}
  }

  async function stampedResponse(response) {
    const body = await response.clone().arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set('x-library-cached-at', String(Date.now()));
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }

  async function store(cache, request, response) {
    if (!response?.ok) return;
    try { await cache.put(request, await stampedResponse(response)); } catch {}
  }

  window.LibraryDataCache = { clear, name: CACHE_NAME, ttlFor };

  window.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : new Request(input, init);
    if (!isSupabaseRest(request)) return nativeFetch(input, init);

    if (request.method !== 'GET') {
      const response = await nativeFetch(input, init);
      if (response.ok) clear();
      return response;
    }

    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (cached) {
        const savedAt = Number(cached.headers.get('x-library-cached-at') || 0);
        const age = savedAt ? Date.now() - savedAt : Infinity;
        const ttl = ttlFor(request);
        if (age < ttl) return cached.clone();

        // Stale-while-revalidate: return known library data immediately, refresh quietly.
        nativeFetch(input, init).then(response => store(cache, request, response)).catch(() => {});
        return cached.clone();
      }

      const response = await nativeFetch(input, init);
      await store(cache, request, response);
      return response;
    } catch {
      return nativeFetch(input, init);
    }
  };
})();
