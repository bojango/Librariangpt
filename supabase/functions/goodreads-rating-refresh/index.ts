import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  MAX_GOODREADS_BATCH_SIZE,
  cleanIsbn,
  failureStateUpdate,
  goodreadsBookIdentity,
  parseGoodreadsJsonLd,
  processSequentially,
  shouldRefreshGoodreads,
  successStateUpdate,
  validateGoodreadsCandidate
} from '../_shared/goodreads.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const PROVIDER = 'Goodreads';
const REQUEST_TIMEOUT_MS = 8_000;
const USER_AGENT = 'ReadingRoom-GoodreadsRatingCache/1.0 (personal library; conservative scheduled refresh)';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' }
});

class RefreshError extends Error {
  status: number | null;
  transient: boolean;
  constructor(message: string, status: number | null = null, transient = true) {
    super(message);
    this.status = status;
    this.transient = transient;
  }
}

async function goodreadsFetch(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.7'
      }
    });
    if (!response.ok) {
      const transient = response.status === 403 || response.status === 429 || response.status >= 500;
      throw new RefreshError(`Goodreads returned HTTP ${response.status}`, response.status, transient);
    }
    const html = await response.text();
    if (/captcha|robot check|verify (?:that )?you are human|automated requests/i.test(html)) {
      throw new RefreshError('Goodreads verification blocked the request', response.status, true);
    }
    return { html, finalUrl: response.url || url };
  } catch (error) {
    if (error instanceof RefreshError) throw error;
    if ((error as Error)?.name === 'AbortError') throw new RefreshError('Goodreads request timed out');
    throw new RefreshError('Goodreads request failed');
  } finally {
    clearTimeout(timer);
  }
}

function candidateUrls(html: string, finalUrl: string) {
  const values = [] as string[];
  const redirected = goodreadsBookIdentity(finalUrl);
  if (redirected) values.push(redirected.sourceUrl);
  for (const match of html.matchAll(/href=["'](?:https:\/\/(?:www\.)?goodreads\.com)?(\/book\/show\/\d+[^"'#?]*)["']/gi)) {
    const identity = goodreadsBookIdentity(`https://www.goodreads.com${match[1].replace(/&amp;/g, '&')}`);
    if (identity) values.push(identity.sourceUrl);
  }
  return [...new Set(values)];
}

async function recordFailure(admin: any, bookId: string, error: RefreshError) {
  const current = await admin.from('rating_refresh_state').select('failure_count').eq('book_id', bookId).eq('provider', PROVIDER).maybeSingle();
  const payload = failureStateUpdate(bookId, current.data?.failure_count, error.message, error.status);
  const result = await admin.from('rating_refresh_state').upsert(payload, { onConflict: 'book_id,provider' });
  if (result.error) console.error('Could not persist Goodreads failure state', result.error);
  return payload.failure_count;
}

async function recordSuccess(admin: any, bookId: string) {
  const result = await admin.from('rating_refresh_state').upsert(successStateUpdate(bookId), { onConflict: 'book_id,provider' });
  if (result.error) throw new Error(`Could not save Goodreads refresh state: ${result.error.message}`);
}

async function saveRating(admin: any, bookId: string, existing: any, identity: any, parsed: any) {
  const payload = {
    book_id: bookId,
    provider: PROVIDER,
    provider_book_id: identity.providerBookId,
    source_url: identity.sourceUrl,
    rating_5: parsed.rating_5,
    rating_count: parsed.rating_count,
    review_count: parsed.review_count,
    is_primary: true,
    fetched_at: new Date().toISOString(),
    notes: 'Cached from public Goodreads structured book metadata.'
  };
  const write = existing?.id
    ? await admin.from('public_ratings').update(payload).eq('id', existing.id)
    : await admin.from('public_ratings').insert(payload);
  if (write.error) throw new Error(`Could not cache Goodreads rating: ${write.error.message}`);
  await admin.from('public_ratings').update({ is_primary: false }).eq('book_id', bookId).neq('provider', PROVIDER);
  await recordSuccess(admin, bookId);
  return payload;
}

async function directRefresh(admin: any, book: any, existing: any, identity: any) {
  const page = await goodreadsFetch(identity.sourceUrl);
  const parsed = parseGoodreadsJsonLd(page.html);
  if (!parsed) throw new RefreshError('Goodreads structured rating metadata was unavailable', 200, true);
  return saveRating(admin, book.id, existing, identity, parsed);
}

async function discover(admin: any, book: any, existing: any) {
  const queries = [cleanIsbn(book.isbn13), cleanIsbn(book.isbn10), `${book.title} ${book.author}`]
    .map(value => value.trim()).filter(Boolean);
  const visited = new Set<string>();
  for (const query of queries) {
    const search = await goodreadsFetch(`https://www.goodreads.com/search?q=${encodeURIComponent(query)}`);
    const urls = candidateUrls(search.html, search.finalUrl).filter(url => !visited.has(url));
    for (const sourceUrl of urls.slice(0, /^\d{10,13}[X]?$/.test(query) ? 1 : 2)) {
      visited.add(sourceUrl);
      const identity = goodreadsBookIdentity(sourceUrl);
      if (!identity) continue;
      const page = sourceUrl === search.finalUrl ? search : await goodreadsFetch(sourceUrl);
      const parsed = parseGoodreadsJsonLd(page.html);
      if (!parsed) continue;
      const match = validateGoodreadsCandidate(book, parsed);
      if (!match.matched) continue;
      return saveRating(admin, book.id, existing, identity, parsed);
    }
  }
  throw new RefreshError('No confident Goodreads match found', null, false);
}

async function refreshBook(admin: any, bookId: string, force: boolean) {
  const [bookResult, authorResult, ratingResult, stateResult] = await Promise.all([
    admin.from('v_library').select('id,title,authors,isbn10,isbn13').eq('id', bookId).maybeSingle(),
    admin.from('book_authors').select('author_order,authors(name)').eq('book_id', bookId).order('author_order').limit(1).maybeSingle(),
    admin.from('public_ratings').select('id,provider,provider_book_id,source_url,rating_5,rating_count,review_count,fetched_at').eq('book_id', bookId).ilike('provider', PROVIDER).limit(1).maybeSingle(),
    admin.from('rating_refresh_state').select('last_attempted_at,last_success_at,next_retry_at,failure_count,last_error,last_http_status').eq('book_id', bookId).eq('provider', PROVIDER).maybeSingle()
  ]);
  if (bookResult.error || !bookResult.data) return { book_id: bookId, ok: false, status: 'not_found' };
  const existing = ratingResult.data || null;
  if (!shouldRefreshGoodreads({ rating: existing, refreshState: stateResult.data, force })) {
    return { book_id: bookId, ok: true, status: 'fresh', cached: true };
  }
  const claim = await admin.rpc('claim_goodreads_rating_refresh', { p_book_id: bookId, p_force: force });
  if (claim.error) throw new Error(`Could not claim Goodreads refresh: ${claim.error.message}`);
  if (claim.data !== true) return { book_id: bookId, ok: true, status: 'not_due', cached: true };
  const book = {
    ...bookResult.data,
    author: String(authorResult.data?.authors?.name || authorResult.data?.authors?.[0]?.name || bookResult.data.authors || '').split(',')[0].trim()
  };
  const identity = goodreadsBookIdentity(existing?.provider_book_id) || goodreadsBookIdentity(existing?.source_url);
  try {
    const rating = identity
      ? await directRefresh(admin, book, existing, identity)
      : await discover(admin, book, existing);
    return { book_id: bookId, ok: true, status: identity ? 'refreshed' : 'resolved', rating };
  } catch (error) {
    const refreshError = error instanceof RefreshError ? error : new RefreshError((error as Error)?.message || 'Goodreads refresh failed');
    const failureCount = await recordFailure(admin, bookId, refreshError);
    return {
      book_id: bookId,
      ok: false,
      status: refreshError.transient ? 'retry_scheduled' : 'unresolved',
      error: refreshError.message,
      http_status: refreshError.status,
      failure_count: failureCount,
      cached_rating_preserved: Boolean(existing?.rating_5 != null)
    };
  }
}

async function authorise(req: Request, url: string, anon: string, service: string) {
  const auth = req.headers.get('Authorization') || '';
  const apiKey = req.headers.get('apikey') || '';
  if (auth === `Bearer ${service}` || apiKey === service) return { service: true };
  if (!auth) return null;
  const user = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const userResult = await user.auth.getUser();
  if (userResult.error || !userResult.data.user) return null;
  const owner = await user.rpc('is_library_owner');
  return owner.data === true ? { service: false, userId: userResult.data.user.id } : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const caller = await authorise(req, url, anon, service);
    if (!caller) return json({ error: 'Not authorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;
    const admin = createClient(url, service);
    let bookIds = [] as string[];
    if (body?.book_id) bookIds = [String(body.book_id)];
    else if (Array.isArray(body?.book_ids)) bookIds = body.book_ids.map(String);
    else {
      if (!caller.service) return json({ error: 'book_id required' }, 400);
      const requested = Number(body?.batch_size || 6);
      const batchSize = Math.min(MAX_GOODREADS_BATCH_SIZE, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 6));
      const due = await admin.rpc('select_due_goodreads_rating_books', { p_limit: batchSize });
      if (due.error) throw new Error(`Could not select due Goodreads books: ${due.error.message}`);
      bookIds = (due.data || []).map((row: any) => String(row.book_id));
    }
    bookIds = [...new Set(bookIds)].slice(0, MAX_GOODREADS_BATCH_SIZE);
    if (!bookIds.length) return json({ ok: true, processed: 0, results: [] });
    const results = await processSequentially(bookIds, bookId => refreshBook(admin, bookId, force));
    return json({ ok: results.every(result => result.ok || result.status === 'unresolved' || result.status === 'retry_scheduled'), processed: results.length, results });
  } catch (error) {
    console.error(error);
    return json({ error: (error as Error)?.message || 'Goodreads refresh failed' }, 500);
  }
});
