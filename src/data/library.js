import { supabase } from './supabase.js';
import { dedupeResults, exactIsbnMatch, isValidIsbn } from '../utils/text.js';

const requests = new Map();
let diagnosticHook = null;

export function setDataDiagnosticHook(hook) {
  diagnosticHook = hook;
}

function dedupe(key, work) {
  if (!requests.has(key)) requests.set(key, Promise.resolve().then(work).finally(() => requests.delete(key)));
  else diagnosticHook?.event('request_deduped', { request_key: key });
  return requests.get(key);
}

function unwrap(result, fallback = []) {
  if (result.error) throw result.error;
  return result.data ?? fallback;
}

async function optional(query, fallback = []) {
  try { return unwrap(await query, fallback); }
  catch (error) { console.info('[Reading Room] optional dataset unavailable:', error?.message || error); return fallback; }
}

export function clearRequestDedupe() {
  requests.clear();
}

export function loadLibrarySnapshot() {
  return dedupe('library-snapshot', async () => {
    const [books, recommendations, upNext, aiRecommendations, chapters] = await Promise.all([
      supabase.from('v_library').select('*').order('title'),
      optional(supabase.from('recommendations').select('book_id,recommendation_strength,match_score_10,recommendation_status,why_recommended,frontend_featured,frontend_shelf,user_interest,prediction_accuracy_5,outcome,date_recommended').order('match_score_10', { ascending: false, nullsFirst: false })),
      optional(supabase.from('v_up_next').select('*').order('position')),
      optional(supabase.from('v_ai_recommendations').select('*').order('display_rank', { ascending: true })),
      optional(supabase.from('v_library_chapters').select('*').eq('overall_status', 'Currently Reading'))
    ]);
    return {
      books: unwrap(books),
      recommendations,
      upNext,
      aiRecommendations,
      chapters
    };
  });
}

export function loadBookDetail(bookId) {
  return dedupe(`book:${bookId}`, async () => {
    const [book, ratings, recommendation, quotes, editions, enrichment] = await Promise.all([
      supabase.from('v_library').select('*').eq('id', bookId).single(),
      optional(supabase.from('public_ratings').select('provider,rating_5,rating_count,review_count,source_url,is_primary,fetched_at').eq('book_id', bookId).order('is_primary', { ascending: false }).order('fetched_at', { ascending: false })),
      optional(supabase.from('recommendations').select('why_recommended,match_score_10,outcome,recommendation_strength,date_recommended').eq('book_id', bookId).order('date_recommended', { ascending: false }).limit(1).maybeSingle(), null),
      optional(supabase.from('book_quotes').select('id,book_id,edition_id,session_id,page_start,page_end,chapter,quote_text,note,capture_method,created_at,updated_at').eq('book_id', bookId).order('page_start', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true })),
      optional(supabase.from('editions').select('*').eq('book_id', bookId)),
      optional(supabase.from('books').select('editions_status,editions_last_refreshed_at,editions_error,metadata_status,metadata_retry_after').eq('id', bookId).single(), {})
    ]);
    return { book: unwrap(book, null), ratings, recommendation, quotes, editions, enrichment };
  });
}

export async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  clearRequestDedupe();
  return data;
}

export async function searchBooks({ query, author = '', mode = 'title' }) {
  const primary = await invoke('book-search', { query, author: author || null });
  let results = primary?.results || [];
  if (mode === 'title' && !results.length) {
    const fallback = await invoke('book-search-fallback', { query, author: author || null }).catch(() => null);
    results = fallback?.results || [];
  }
  results = dedupeResults(results);
  if (mode === 'isbn' && isValidIsbn(query)) {
    results = results.filter(result => exactIsbnMatch(query, result));
  }
  return results;
}

export async function refreshLibrary() {
  clearRequestDedupe();
  return loadLibrarySnapshot();
}

export async function latestReadingSession(bookId) {
  return optional(supabase.from('reading_sessions').select('id,edition_id,status,started_at').eq('book_id', bookId).order('started_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle(), null);
}

export async function saveQuote(book, values, quoteId = null) {
  if (quoteId) {
    const { error } = await supabase.from('book_quotes').update(values).eq('id', quoteId);
    if (error) throw error;
  } else {
    const session = await latestReadingSession(book.id);
    const payload = {
      ...values,
      book_id: book.id,
      edition_id: session?.edition_id || book.current_edition_id || book.display_edition_id || book.reference_edition_id || null,
      session_id: session?.id || null
    };
    const { error } = await supabase.from('book_quotes').insert(payload);
    if (error) throw error;
  }
  clearRequestDedupe();
}

export async function deleteQuote(quoteId) {
  const { error } = await supabase.from('book_quotes').delete().eq('id', quoteId);
  if (error) throw error;
  clearRequestDedupe();
}

export async function addManualCover(row) {
  const { data, error } = await supabase.from('book_cover_candidates').upsert(row, { onConflict: 'book_id,source_url' }).select('id').single();
  if (error) throw error;
  return data;
}
