(() => {
  const CACHE_NAME = 'librariangpt-data-v5';
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

  const isRoutineEnrichment = async request => {
    const u = urlOf(request);
    if (!u || request.method !== 'POST' || !u.hostname.endsWith('.supabase.co') || !u.pathname.endsWith('/functions/v1/content-enrichment')) return null;
    try {
      const body = await request.clone().json();
      return body?.force === true ? null : body;
    } catch { return null; }
  };

  function isVolatile(request) {
    const path = new URL(request.url).pathname;
    return path.includes('/v_library') || path.includes('/v_library_chapters') || path.includes('/library_entries') || path.includes('/reading_sessions') || path.includes('/progress_logs') || path.includes('/up_next_queue');
  }

  function ttlFor(request) {
    const path = new URL(request.url).pathname;
    if (path.includes('/v_library') || path.includes('/v_library_chapters') || path.includes('/library_entries') || path.includes('/reading_sessions') || path.includes('/progress_logs') || path.includes('/up_next_queue')) return 45 * 1000;
    if (path.includes('/recommendations') || path.includes('/v_ai_recommendations')) return 10 * MINUTE;
    if (path.includes('/public_ratings')) return 7 * 24 * HOUR;
    if (path.includes('/book_cover_candidates')) return 30 * 24 * HOUR;
    if (path.includes('/books') || path.includes('/editions') || path.includes('/authors') || path.includes('/series')) return 2 * HOUR;
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

  async function networkAndStore(cache, input, init, request) {
    const response = await nativeFetch(input, init);
    await store(cache, request, response);
    return response;
  }

  window.LibraryDataCache = { clear, name: CACHE_NAME, ttlFor };

  window.fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : new Request(input, init);

    const routine = await isRoutineEnrichment(request);
    if (routine) {
      nativeFetch(request.clone()).then(async response => {
        if (response.ok) {
          await clear();
          window.dispatchEvent(new CustomEvent('library-enrichment-complete', { detail: { bookId: routine.book_id || null } }));
        }
      }).catch(() => {});
      return new Response(JSON.stringify({ ok: true, background: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!isSupabaseRest(request)) return nativeFetch(input, init);

    if (request.method !== 'GET') {
      const response = await nativeFetch(input, init);
      if (response.ok) clear();
      return response;
    }

    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request);
      if (!cached) return networkAndStore(cache, input, init, request);

      const savedAt = Number(cached.headers.get('x-library-cached-at') || 0);
      const age = savedAt ? Date.now() - savedAt : Infinity;
      const ttl = ttlFor(request);
      if (age < ttl) return cached.clone();

      // Reading/library state must be fresh once its short TTL expires. The old cache returned stale data
      // and only refreshed behind the scenes, which made newly-added books appear to vanish.
      if (isVolatile(request)) {
        try { return await networkAndStore(cache, input, init, request); }
        catch { return cached.clone(); }
      }

      // Long-lived metadata can safely use stale-while-revalidate for speed.
      nativeFetch(input, init).then(response => store(cache, request, response)).catch(() => {});
      return cached.clone();
    } catch {
      return nativeFetch(input, init);
    }
  };
})();
