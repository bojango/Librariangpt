(() => {
  const CACHE_NAME = 'librariangpt-data-v3';
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
      if (cached) {
        const savedAt = Number(cached.headers.get('x-library-cached-at') || 0);
        const age = savedAt ? Date.now() - savedAt : Infinity;
        const ttl = ttlFor(request);
        if (age < ttl) return cached.clone();

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
