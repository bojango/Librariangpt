(() => {
  const CACHE_NAME = 'librariangpt-data-v1';
  const TTL = 30 * 60 * 1000;
  const nativeFetch = window.fetch.bind(window);

  const isSupabaseRest = url => {
    try {
      const u = new URL(typeof url === 'string' ? url : url.url);
      return u.hostname.endsWith('.supabase.co') && u.pathname.startsWith('/rest/v1/');
    } catch { return false; }
  };

  async function clear() {
    try { await caches.delete(CACHE_NAME); } catch {}
  }

  async function stampedResponse(response) {
    const body = await response.clone().arrayBuffer();
    const headers = new Headers(response.headers);
    headers.set('x-library-cached-at', String(Date.now()));
    return new Response(body, { status: response.status, statusText: response.statusText, headers });
  }

  window.LibraryDataCache = { clear, name: CACHE_NAME, ttl: TTL };

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
        if (savedAt && Date.now() - savedAt < TTL) return cached.clone();
        await cache.delete(request);
      }

      const response = await nativeFetch(input, init);
      if (response.ok) {
        const stored = await stampedResponse(response);
        await cache.put(request, stored);
      }
      return response;
    } catch {
      return nativeFetch(input, init);
    }
  };
})();
