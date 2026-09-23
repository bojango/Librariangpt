export function providerDiagnostics() {
  return {
    google_books: { attempted: 0, successful: 0, zero_result_queries: 0, http_errors: [], timeouts: 0, fetch_errors: 0, malformed_json: 0, rate_limited: false, retry_after_seconds: null, retry_after_at: null, skipped_due_to_rate_limit: 0 },
    open_library: { attempted: 0, successful: 0, zero_result_queries: 0, http_errors: [], timeouts: 0, fetch_errors: 0, malformed_json: 0 }
  };
}

export function providerForUrl(url) { return /googleapis\.com\/books/i.test(url) ? 'google_books' : 'open_library'; }
export function recordZeroResult(diagnostics, provider) { if (diagnostics?.[provider]) diagnostics[provider].zero_result_queries += 1; }
export function parseRetryAfter(value, now = Date.now()) {
  const seconds = Number(String(value || '').trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(Math.round(seconds), 24 * 60 * 60);
  const at = Date.parse(String(value || ''));
  return Number.isFinite(at) && at > now ? Math.min(Math.ceil((at - now) / 1000), 24 * 60 * 60) : null;
}
export function googleRetryAfter(diagnostics, now = Date.now()) {
  const seconds = diagnostics?.google_books?.retry_after_seconds;
  return new Date(now + ((Number.isFinite(seconds) ? seconds : 45 * 60) * 1000)).toISOString();
}

export async function fetchProviderJson(url, timeoutMs, diagnostics, { googleApiKey = '' } = {}) {
  const provider = providerForUrl(url);
  const detail = diagnostics?.[provider];
  if (provider === 'google_books' && detail?.rate_limited) { detail.skipped_due_to_rate_limit += 1; return null; }
  if (detail) detail.attempted += 1;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestUrl = new URL(url);
    if (provider === 'google_books' && googleApiKey) requestUrl.searchParams.set('key', googleApiKey);
    const response = await fetch(requestUrl.toString(), { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReadingRoom/8.1; +personal-library)', Accept: 'application/json,*/*;q=0.8' } });
    if (!response.ok) {
      if (detail) {
        detail.http_errors.push(response.status);
        if (provider === 'google_books' && response.status === 429) {
          detail.rate_limited = true;
          detail.retry_after_seconds = parseRetryAfter(response.headers.get('Retry-After'));
          detail.retry_after_at = googleRetryAfter(diagnostics);
        }
      }
      return null;
    }
    try {
      const data = await response.json();
      if (detail) detail.successful += 1;
      return data;
    } catch { if (detail) detail.malformed_json += 1; return null; }
  } catch (error) {
    if ((error)?.name === 'AbortError') { if (detail) detail.timeouts += 1; }
    else if (detail) detail.fetch_errors += 1;
    return null;
  } finally { clearTimeout(timeout); }
}

// Open Library's pagination is often a plain page count. Reject prose/ranges so
// arbitrary physical-description text cannot become a false page total.
export function openLibraryPageCount(numberOfPages, pagination) {
  const direct = Number(numberOfPages);
  if (Number.isInteger(direct) && direct > 0 && direct <= 10000) return direct;
  const match = String(pagination ?? '').trim().match(/^(\d{1,4})(?:\s*(?:p\.|pages?))?$/i);
  const fallback = match ? Number(match[1]) : null;
  return fallback && fallback > 0 ? fallback : null;
}
