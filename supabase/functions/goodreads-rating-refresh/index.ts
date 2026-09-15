import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  MAX_GOODREADS_BATCH_SIZE,
  DEFAULT_GOODREADS_BATCH_SIZE,
  candidateLimitForQuery,
  cleanIsbn,
  extractGoodreadsCandidateUrls,
  failureStateUpdate,
  goodreadsDiscoveryQueries,
  goodreadsBookIdentity,
  parseGoodreadsJsonLd,
  processSequentially,
  normalizeText,
  selectDominantExactTitleIdentity,
  shouldRefreshGoodreads,
  successStateUpdate,
  titleSimilarity,
  validIsbn,
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
  diagnostic: Record<string, unknown> | null;
  constructor(message: string, status: number | null = null, transient = true, diagnostic: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.transient = transient;
    this.diagnostic = diagnostic;
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
    if (!response.ok || response.status === 202) {
      const transient = response.status === 403 || response.status === 429 || response.status >= 500;
      throw new RefreshError(
        response.status === 202 ? 'Goodreads search response was not ready' : `Goodreads returned HTTP ${response.status}`,
        response.status,
        response.status === 202 || transient,
        { reason: response.status === 202 ? 'search_response_not_ready' : 'http_error', http_status: response.status }
      );
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

async function recordFailure(admin: any, bookId: string, error: RefreshError) {
  const current = await admin.from('rating_refresh_state').select('failure_count').eq('book_id', bookId).eq('provider', PROVIDER).maybeSingle();
  const payload = failureStateUpdate(bookId, current.data?.failure_count, error.message, error.status, Date.now(), error.diagnostic as any);
  const result = await admin.from('rating_refresh_state').upsert(payload, { onConflict: 'book_id,provider' });
  if (result.error) console.error('Could not persist Goodreads failure state', result.error);
  return payload.failure_count;
}

async function recordSuccess(admin: any, bookId: string, tier: string) {
  const result = await admin.from('rating_refresh_state').upsert(successStateUpdate(bookId, Date.now(), tier), { onConflict: 'book_id,provider' });
  if (result.error) throw new Error(`Could not save Goodreads refresh state: ${result.error.message}`);
}

async function saveRating(admin: any, bookId: string, existing: any, identity: any, parsed: any, tier = 'WORK_CONFIRMED') {
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
  const write = await admin.from('public_ratings').upsert(payload, { onConflict: 'book_id,provider' });
  if (write.error) throw new Error(`Could not cache Goodreads rating: ${write.error.message}`);
  await admin.from('public_ratings').update({ is_primary: false }).eq('book_id', bookId).neq('provider', PROVIDER);
  await recordSuccess(admin, bookId, tier);
  return payload;
}

async function directRefresh(admin: any, book: any, existing: any, identity: any) {
  const page = await goodreadsFetch(identity.sourceUrl);
  const parsed = parseGoodreadsJsonLd(page.html);
  if (!parsed) throw new RefreshError('Goodreads structured rating metadata was unavailable', 200, true);
  return saveRating(admin, book.id, existing, identity, parsed, 'WORK_CONFIRMED');
}

async function fetchJson(url: string) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function firstValidIsbn(values: unknown[], length: number) {
  return values.map(cleanIsbn).find(value => value.length === length && validIsbn(value)) || null;
}

async function openLibraryEvidence(book: any) {
  const url = new URL('https://openlibrary.org/search.json');
  url.searchParams.set('title', book.title);
  url.searchParams.set('limit', '10');
  url.searchParams.set('fields', 'key,title,author_name,isbn');
  const result = await fetchJson(url.toString());
  const candidates = (Array.isArray(result?.docs) ? result.docs : []).map((item: any) => {
    const isbns = Array.isArray(item?.isbn) ? item.isbn : [];
    const isbn13 = firstValidIsbn(isbns, 13);
    return {
      title: item?.title,
      authors: Array.isArray(item?.author_name) ? item.author_name : [],
      isbn13,
      // Search results aggregate editions, so never pair unrelated ISBN-10/13 values.
      isbn10: isbn13 ? null : firstValidIsbn(isbns, 10),
      provider: 'Open Library',
      provider_item_id: String(item?.key || '')
    };
  });
  return { identity: selectDominantExactTitleIdentity(book, candidates), candidates };
}

async function persistMetadataRepair(admin: any, book: any, editions: any[], identity: any) {
  if (book.author || !identity?.author) return { book, repaired: false, reason: 'canonical_author_already_present' };
  const authors = await admin.from('authors').select('id,name');
  if (authors.error) return { book, repaired: false, reason: 'author_lookup_failed' };
  let author = (authors.data || []).find((item: any) => normalizeText(item.name) === normalizeText(identity.author));
  if (!author) {
    const inserted = await admin.from('authors').insert({ name: identity.author }).select('id,name').single();
    if (inserted.error) return { book, repaired: false, reason: 'author_insert_failed' };
    author = inserted.data;
  }
  const link = await admin.from('book_authors').upsert({ book_id: book.id, author_id: author.id, author_order: 1, role: 'Author' }, { onConflict: 'book_id,author_id' });
  if (link.error) return { book, repaired: false, reason: 'author_link_failed' };

  let isbn13 = editions.find(row => row.isbn13)?.isbn13 || null;
  let isbn10 = editions.find(row => row.isbn10)?.isbn10 || null;
  if (!isbn13 && !isbn10 && (identity.isbn13 || identity.isbn10)) {
    const identifier = identity.isbn13 || identity.isbn10;
    const existingEdition = await admin.from('editions').select('id,book_id,isbn10,isbn13').or(`isbn13.eq.${identifier},isbn10.eq.${identifier}`).maybeSingle();
    if (!existingEdition.error && !existingEdition.data) {
      const edition = await admin.from('editions').insert({
        book_id: book.id,
        isbn13: identity.isbn13,
        isbn10: identity.isbn10,
        preferred_copy: false,
        open_library_work_id: identity.providerItemId?.match(/OL\d+W/i)?.[0] || null,
        metadata_source: 'goodreads_resolver_open_library',
        metadata_match_confidence: 'Exact title and dominant primary author'
      }).select('isbn10,isbn13').single();
      if (!edition.error) {
        isbn13 = edition.data?.isbn13 || null;
        isbn10 = edition.data?.isbn10 || null;
      }
    }
  }
  return {
    book: { ...book, author: author.name, isbn13: isbn13 || book.isbn13, isbn10: isbn10 || book.isbn10 },
    repaired: true,
    source: identity.provider || 'trusted_existing_metadata'
  };
}

async function enrichMissingIdentity(admin: any, book: any, editions: any[], metadataCandidates: any[]) {
  if (book.author) return { book, repaired: false, reason: 'not_needed' };
  const trustedCandidates = (metadataCandidates || []).filter((candidate: any) =>
    /^(?:Open Library|Google Books)$/i.test(String(candidate.provider || ''))
    && (candidate.selected === true || Number(candidate.score || 0) >= 0.98)
  ).map((candidate: any) => ({
    title: candidate.candidate_title,
    authors: candidate.candidate_authors,
    isbn10: candidate.isbn10,
    isbn13: candidate.isbn13,
    provider: candidate.provider,
    provider_item_id: candidate.provider_item_id
  }));
  const existingIdentity = selectDominantExactTitleIdentity(book, trustedCandidates);
  const openLibrary = existingIdentity ? { identity: null, candidates: [] } : await openLibraryEvidence(book);
  const identity = existingIdentity || openLibrary.identity;
  if (!identity) return { book, repaired: false, reason: 'trusted_metadata_ambiguous_or_missing', evidence: openLibrary.candidates };
  return persistMetadataRepair(admin, book, editions, identity);
}

async function discover(admin: any, book: any, existing: any, editions: any[], metadataEvidence: any[] = []) {
  const queries = goodreadsDiscoveryQueries(book);
  const visited = new Set<string>();
  const diagnostic = { canonical: { title: book.title, author: book.author || null, isbn10: book.isbn10 || null, isbn13: book.isbn13 || null }, queries: [] as any[] };
  for (const query of queries) {
    const search = await goodreadsFetch(`https://www.goodreads.com/search?q=${encodeURIComponent(query)}`);
    const urls = extractGoodreadsCandidateUrls(search.html, search.finalUrl).filter(url => !visited.has(url));
    const queryDiagnostic = {
      query: String(query).slice(0, 160),
      candidate_count: urls.length,
      candidate_ids: urls.slice(0, 10).map(url => goodreadsBookIdentity(url)?.providerBookId).filter(Boolean),
      evaluated: [] as any[]
    };
    diagnostic.queries.push(queryDiagnostic);
    for (const sourceUrl of urls.slice(0, candidateLimitForQuery(query))) {
      visited.add(sourceUrl);
      const identity = goodreadsBookIdentity(sourceUrl);
      if (!identity) continue;
      const searchIdentity = goodreadsBookIdentity(search.finalUrl);
      const page = searchIdentity?.providerBookId === identity.providerBookId ? search : await goodreadsFetch(sourceUrl);
      const parsed = parseGoodreadsJsonLd(page.html);
      if (!parsed) {
        queryDiagnostic.evaluated.push({ provider_book_id: identity.providerBookId, rejection_reason: 'structured_data_unavailable' });
        continue;
      }
      if (!book.author && titleSimilarity(book.title, parsed.title).strictScore === 1) {
        const corroborating = metadataEvidence.find((candidate: any) =>
          titleSimilarity(book.title, candidate.title).strictScore === 1
          && candidate.authors?.[0]
          && parsed.authors?.[0]
          && normalizeText(candidate.authors[0]) === normalizeText(parsed.authors[0])
        );
        if (corroborating) {
          const repaired = await persistMetadataRepair(admin, book, editions, selectDominantExactTitleIdentity(book, [corroborating]));
          if (repaired.repaired) book = repaired.book;
        }
      }
      const match: any = validateGoodreadsCandidate(book, parsed);
      queryDiagnostic.evaluated.push({
        provider_book_id: identity.providerBookId,
        title: parsed.title,
        authors: parsed.authors.slice(0, 4),
        isbns: parsed.isbns.slice(0, 4),
        title_similarity: match.titleScore ?? null,
        strict_title_similarity: match.strictTitleScore ?? null,
        base_title_similarity: match.baseTitleScore ?? null,
        author_similarity: match.authorScore ?? null,
        exact_isbn: match.exactIsbn === true,
        accepted: match.matched === true,
        tier: match.tier,
        rejection_reason: match.matched ? null : match.reason
      });
      if (!match.matched) continue;
      return saveRating(admin, book.id, existing, identity, parsed, match.tier);
    }
  }
  throw new RefreshError('No confident Goodreads match found', null, false, diagnostic);
}

async function refreshBook(admin: any, bookId: string, force: boolean) {
  const [bookResult, authorResult, libraryResult, editionsResult, ratingResult, stateResult, metadataCandidatesResult] = await Promise.all([
    admin.from('books').select('id,title,subtitle,reference_edition_id,metadata_source,metadata_status').eq('id', bookId).maybeSingle(),
    admin.from('book_authors').select('author_order,authors(name)').eq('book_id', bookId).order('author_order').limit(1).maybeSingle(),
    admin.from('library_entries').select('current_edition_id').eq('book_id', bookId).maybeSingle(),
    admin.from('editions').select('id,isbn10,isbn13,preferred_copy,created_at').eq('book_id', bookId).order('preferred_copy', { ascending: false }).order('created_at'),
    admin.from('public_ratings').select('id,provider,provider_book_id,source_url,rating_5,rating_count,review_count,fetched_at').eq('book_id', bookId).ilike('provider', PROVIDER).limit(1).maybeSingle(),
    admin.from('rating_refresh_state').select('last_attempted_at,last_success_at,next_retry_at,failure_count,last_error,last_http_status').eq('book_id', bookId).eq('provider', PROVIDER).maybeSingle(),
    admin.from('book_metadata_candidates').select('provider,provider_item_id,candidate_title,candidate_authors,isbn10,isbn13,score,selected').eq('book_id', bookId).order('selected', { ascending: false }).order('score', { ascending: false }).limit(10)
  ]);
  if (bookResult.error) {
    const lookupError = new RefreshError('Could not load Goodreads book metadata', null, true, { reason: 'book_metadata_lookup_failed' });
    const failureCount = await recordFailure(admin, bookId, lookupError);
    return { book_id: bookId, ok: false, status: 'retry_scheduled', error: lookupError.message, failure_count: failureCount };
  }
  if (!bookResult.data) return { book_id: bookId, ok: false, status: 'not_found' };
  const existing = ratingResult.data || null;
  if (!shouldRefreshGoodreads({ rating: existing, refreshState: stateResult.data, force })) {
    return { book_id: bookId, ok: true, status: 'fresh', cached: true };
  }
  const claim = await admin.rpc('claim_goodreads_rating_refresh', { p_book_id: bookId, p_force: force });
  if (claim.error) throw new Error(`Could not claim Goodreads refresh: ${claim.error.message}`);
  if (claim.data !== true) return { book_id: bookId, ok: true, status: 'not_due', cached: true };
  const editions = editionsResult.data || [];
  const preferredEditionId = libraryResult.data?.current_edition_id || bookResult.data.reference_edition_id;
  const edition = editions.find((row: any) => row.id === preferredEditionId)
    || editions.find((row: any) => row.isbn13 || row.isbn10)
    || {};
  let book = {
    ...bookResult.data,
    isbn13: edition.isbn13 || null,
    isbn10: edition.isbn10 || null,
    author: String(authorResult.data?.authors?.name || authorResult.data?.authors?.[0]?.name || bookResult.data.authors || '').split(',')[0].trim()
  };
  const identity = goodreadsBookIdentity(existing?.provider_book_id) || goodreadsBookIdentity(existing?.source_url);
  let metadataRepair = null as any;
  try {
    if (!identity && !book.author) {
      metadataRepair = await enrichMissingIdentity(admin, book, editions, metadataCandidatesResult.data || []);
      book = metadataRepair.book;
    }
    const rating = identity
      ? await directRefresh(admin, book, existing, identity)
      : await discover(admin, book, existing, editions, metadataRepair?.evidence || []);
    return { book_id: bookId, ok: true, status: identity ? 'refreshed' : 'resolved', rating, metadata_repaired: metadataRepair?.repaired === true };
  } catch (error) {
    const refreshError = error instanceof RefreshError ? error : new RefreshError((error as Error)?.message || 'Goodreads refresh failed');
    if (metadataRepair) refreshError.diagnostic = { ...(refreshError.diagnostic || {}), metadata_repair: {
      repaired: metadataRepair.repaired === true,
      reason: metadataRepair.reason || null,
      source: metadataRepair.source || null
    } };
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

async function authorise(req: Request, url: string, anon: string, service: string, schedulerToken: string) {
  const auth = req.headers.get('Authorization') || '';
  const apiKey = req.headers.get('apikey') || '';
  const suppliedSchedulerToken = req.headers.get('x-goodreads-scheduler-token') || '';
  if (schedulerToken && suppliedSchedulerToken === schedulerToken) return { service: true, scheduler: true };
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
    const schedulerToken = Deno.env.get('GOODREADS_SCHEDULER_TOKEN') || '';
    const caller = await authorise(req, url, anon, service, schedulerToken);
    if (!caller) return json({ error: 'Not authorized' }, 401);
    const body = await req.json().catch(() => ({}));
    const force = body?.force === true;
    const admin = createClient(url, service);
    let bookIds = [] as string[];
    if (body?.book_id) bookIds = [String(body.book_id)];
    else if (Array.isArray(body?.book_ids)) bookIds = body.book_ids.map(String);
    else {
      if (!caller.service) return json({ error: 'book_id required' }, 400);
      const requested = Number(body?.batch_size || DEFAULT_GOODREADS_BATCH_SIZE);
      const batchSize = Math.min(MAX_GOODREADS_BATCH_SIZE, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : DEFAULT_GOODREADS_BATCH_SIZE));
      const due = await admin.rpc('select_due_goodreads_rating_books', { p_limit: batchSize });
      if (due.error) throw new Error(`Could not select due Goodreads books: ${due.error.message}`);
      bookIds = (due.data || []).map((row: any) => String(row.book_id));
    }
    bookIds = [...new Set(bookIds)].slice(0, MAX_GOODREADS_BATCH_SIZE);
    if (!bookIds.length) return json({ ok: true, processed: 0, results: [] });
    const results = await processSequentially(bookIds, (bookId: string) => refreshBook(admin, bookId, force));
    return json({ ok: results.every(result => result.ok || result.status === 'unresolved' || result.status === 'retry_scheduled'), processed: results.length, results });
  } catch (error) {
    console.error(error);
    return json({ error: (error as Error)?.message || 'Goodreads refresh failed' }, 500);
  }
});
