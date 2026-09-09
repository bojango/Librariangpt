(() => {
  const CACHE_NAME = 'librariangpt-data-v8';
  const nativeFetch = window.fetch.bind(window);
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;

  const urlOf = input => {
    try { return new URL(typeof input === 'string' ? input : input.url); }
    catch { return null; }
  };

  const isSupabaseRest = request => {
    const u = urlOf(request);
    return Boolean(u && u.hostname.endsWith('.supabase.co') && u.pathname.startsWith('/rest/v1/'));
  };

  function isLiveLibraryRequest(request) {
    const path = new URL(request.url).pathname;
    return path.includes('/v_library') || path.includes('/v_library_chapters') ||
      path.includes('/library_entries') || path.includes('/reading_sessions') ||
      path.includes('/progress_logs') || path.includes('/up_next_queue') ||
      path.includes('/books') || path.includes('/editions') ||
      path.includes('/public_ratings') || path.includes('/book_quotes');
  }

  function ttlFor(request) {
    const path = new URL(request.url).pathname;
    if (path.includes('/recommendations') || path.includes('/v_ai_recommendations')) return 10 * MINUTE;
    if (path.includes('/book_cover_candidates')) return 24 * HOUR;
    if (path.includes('/authors') || path.includes('/series')) return 2 * HOUR;
    return 20 * MINUTE;
  }

  async function clear() {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k.startsWith('librariangpt-data-')).map(k => caches.delete(k)));
    } catch {}
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

    // Canonical library state is small and changes while the app is open. Always read it live.
    if (isLiveLibraryRequest(request)) return nativeFetch(input, init);

    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (!cached) {
        const response = await nativeFetch(input, init);
        await store(cache, request, response);
        return response;
      }
      const savedAt = Number(cached.headers.get('x-library-cached-at') || 0);
      const age = savedAt ? Date.now() - savedAt : Infinity;
      if (age < ttlFor(request)) return cached.clone();
      nativeFetch(input, init).then(response => store(cache, request, response)).catch(() => {});
      return cached.clone();
    } catch {
      return nativeFetch(input, init);
    }
  };
})();
