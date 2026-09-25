import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  buildEditionEnrichmentPatch,
  chooseReferenceEdition,
  cleanIsbn,
  isValidIsbn,
  mergeEditionCandidates,
  sameEdition,
  shouldAutoSelectReference
} from '../_shared/edition-ranking.js';
import { fetchProviderJson, googleRetryAfter, openLibraryPageCount, providerDiagnostics, recordZeroResult } from '../_shared/provider-fetch.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const clean = (value: any) => String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const normalise = (value: any) => clean(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(the|a|an)\s+/, '');
const publicationYear = (value: any) => {
  const match = String(value ?? '').match(/(?:^|\D)(1[0-9]{3}|20[0-9]{2}|2100)(?:\D|$)/);
  return match ? Number(match[1]) : null;
};

function similarity(left: any, right: any) {
  const a = normalise(left);
  const b = normalise(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return .96;
  const leftWords = new Set(a.split(' ').filter((word: string) => word.length > 1));
  const rightWords = new Set(b.split(' ').filter((word: string) => word.length > 1));
  return [...leftWords].filter(word => rightWords.has(word)).length / Math.max(leftWords.size, rightWords.size);
}

function authorSimilarity(target: any, candidates: any[] = []) {
  if (!target) return .75;
  let best = 0;
  for (const candidate of candidates) {
    best = Math.max(best, similarity(target, candidate));
    const targetSurname = normalise(target).split(' ').at(-1);
    const candidateSurname = normalise(candidate).split(' ').at(-1);
    if (targetSurname && targetSurname === candidateSurname) best = Math.max(best, .92);
  }
  return best;
}


const googleCover = (volume: any) => {
  const links = volume?.imageLinks || {};
  return [links.extraLarge, links.large, links.medium, links.small, links.thumbnail, links.smallThumbnail].find(Boolean)?.replace(/^http:/, 'https:') || null;
};
const googleIsbn = (volume: any, type: string) => volume?.industryIdentifiers?.find((entry: any) => entry?.type === type)?.identifier ?? null;
const openLibraryCover = (edition: any) => {
  const coverId = Array.isArray(edition?.covers) ? edition.covers.find((value: any) => Number(value) > 0) : null;
  return coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg?default=false` : null;
};

function format(value: any) {
  const normalised = clean(value).toLowerCase();
  if (/hardcover|hardback/.test(normalised)) return 'Hardcover';
  if (/paperback|softcover|mass market/.test(normalised)) return 'Paperback';
  if (/kindle|ebook|e-book|electronic/.test(normalised)) return 'eBook';
  if (/audio/.test(normalised)) return 'Audiobook';
  return clean(value) || null;
}

function language(value: any) {
  const normalised = String(value ?? '').toLowerCase();
  const names: Record<string, string> = { en: 'English', eng: 'English', fr: 'French', fre: 'French', fra: 'French', de: 'German', ger: 'German', deu: 'German', es: 'Spanish', spa: 'Spanish', it: 'Italian', ita: 'Italian' };
  return names[normalised] || clean(value) || null;
}

function workIdFromKey(value: any) {
  return String(value ?? '').match(/(?:\/works\/)?(OL\d+W)/i)?.[1]?.toUpperCase() || null;
}

function editionIdFromKey(value: any) {
  return String(value ?? '').match(/(?:\/books\/)?(OL\d+M)/i)?.[1]?.toUpperCase() || null;
}

function activeEditions(book: any, editions: any[]) {
  const ids = [book.current_edition_id, book.reference_edition_id, book.display_edition_id].filter(Boolean);
  return ids.map(id => editions.find(edition => edition.id === id)).filter(Boolean);
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

  let admin: any;
  let bookId = '';
  let knownEditionCount = 0;
  try {
    const authorization = request.headers.get('Authorization') || '';
    const apiKey = request.headers.get('apikey') || '';
    if (!authorization && !apiKey) return json({ error: 'Authentication required' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const serviceCaller = authorization === `Bearer ${serviceKey}` || apiKey === serviceKey;
    if (!serviceCaller) {
      const user = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
      const userResult = await user.auth.getUser();
      if (userResult.error || !userResult.data.user) return json({ error: 'Invalid session' }, 401);
      const owner = await user.rpc('is_library_owner');
      if (owner.error || owner.data !== true) return json({ error: 'Not authorized' }, 403);
    }
    admin = createClient(url, serviceKey);

    const body = await request.json();
    bookId = String(body?.book_id || '');
    const force = body?.force === true;
    if (!bookId) return json({ error: 'book_id required' }, 400);

    const [bookResult, stateResult, editionsResult] = await Promise.all([
      admin.from('v_library').select('*').eq('id', bookId).single(),
      admin.from('books').select('editions_status,editions_last_refreshed_at,editions_error,metadata_retry_after,reference_edition_id,cover_locked,cover_url_preferred').eq('id', bookId).single(),
      admin.from('editions').select('*').eq('book_id', bookId)
    ]);
    if (bookResult.error || !bookResult.data) return json({ error: 'Book not found' }, 404);
    if (stateResult.error) throw stateResult.error;
    if (editionsResult.error) throw editionsResult.error;

    const book = { ...bookResult.data, reference_edition_id: stateResult.data.reference_edition_id };
    const diagnostics = providerDiagnostics();
    const googleApiKey = Deno.env.get('GOOGLE_BOOKS_API_KEY') || '';
    let existing = editionsResult.data || [];
    knownEditionCount = existing.length;
    const active = activeEditions(book, existing);
    let workId = active.map(edition => edition.open_library_work_id).find(Boolean)
      || existing.filter((edition: any) => edition.open_library_work_id).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id)))[0]?.open_library_work_id
      || null;
    const selectedIsbn = cleanIsbn(active.map(edition => edition.isbn13 || edition.isbn10).find(Boolean) || book.isbn13 || book.isbn10);
    const fresh = stateResult.data.editions_last_refreshed_at
      && Date.now() - new Date(stateResult.data.editions_last_refreshed_at).getTime() < 30 * 86400000;
    const canUseCache = !force && fresh && existing.length > 3 && stateResult.data.editions_status !== 'refreshing';

    if (canUseCache && !shouldAutoSelectReference(book, existing)) {
      return json({ ok: true, cached: true, status: stateResult.data.editions_status, count: existing.length, work_id: workId, editions: existing });
    }

    const refreshing = await admin.from('books').update({ editions_status: 'refreshing', editions_error: null }).eq('id', bookId);
    if (refreshing.error) throw refreshing.error;

    const title = book.title;
    const discoveryTitle = [book.title, book.subtitle].map(clean).filter(Boolean).join(': ');
    const author = String(book.authors || '').split(',')[0].trim();
    let workSource: 'edition' | 'isbn' | 'search' | null = workId ? 'edition' : null;

    if (!workId && selectedIsbn && isValidIsbn(selectedIsbn)) {
      const selectedOpenLibraryEdition = await fetchProviderJson(`https://openlibrary.org/isbn/${encodeURIComponent(selectedIsbn)}.json`, 7000, diagnostics);
      workId = workIdFromKey(selectedOpenLibraryEdition?.works?.[0]?.key);
      if (workId) workSource = 'isbn';
    }

    if (!workId) {
      const searchUrl = new URL('https://openlibrary.org/search.json');
      searchUrl.searchParams.set('title', discoveryTitle || title);
      if (author) searchUrl.searchParams.set('author', author);
      searchUrl.searchParams.set('limit', '10');
      searchUrl.searchParams.set('fields', 'key,title,author_name');
      let search = await fetchProviderJson(searchUrl.toString(), 8000, diagnostics);
      // Generic titles benefit from the subtitle, but preserve a bare-title fallback.
      if (!search?.docs?.length && discoveryTitle && discoveryTitle !== title) {
        searchUrl.searchParams.set('title', title);
        search = await fetchProviderJson(searchUrl.toString(), 8000, diagnostics);
      }
      let best: any = null;
      let bestScore = 0;
      for (const result of Array.isArray(search?.docs) ? search.docs : []) {
        const score = Math.max(similarity(title, result.title), similarity(discoveryTitle, result.title)) * .76 + authorSimilarity(author, result.author_name || []) * .24;
        if (score > bestScore) {
          best = result;
          bestScore = score;
        }
      }
      if (best && bestScore >= .7) {
        workId = workIdFromKey(best.key);
        if (workId) workSource = 'search';
      }
    }

    if (workId && workSource === 'isbn') {
      for (const edition of active) {
        if (!edition.open_library_work_id && [edition.isbn13, edition.isbn10].some(value => cleanIsbn(value) === selectedIsbn)) {
          const update = await admin.from('editions').update({ open_library_work_id: workId, metadata_last_fetched_at: new Date().toISOString() }).eq('id', edition.id);
          if (!update.error) edition.open_library_work_id = workId;
        }
      }
    }

    const candidates: any[] = [];
    let openLibraryCount = 0;
    let openLibraryResponded = false;
    if (workId) {
      for (const offset of [0, 50]) {
        const response = await fetchProviderJson(`https://openlibrary.org/works/${workId}/editions.json?limit=50&offset=${offset}`, 11000, diagnostics);
        if (response) openLibraryResponded = true;
        const rows = Array.isArray(response?.entries) ? response.entries : [];
        openLibraryCount += rows.length;
        for (const edition of rows) {
          const identifiers = [...(edition?.isbn_13 || []), ...(edition?.isbn_10 || [])].map(cleanIsbn).filter(isValidIsbn);
          const coverUrl = openLibraryCover(edition);
          candidates.push({
            open_library_edition_id: editionIdFromKey(edition?.key), open_library_work_id: workId,
            isbn13: identifiers.find((value: string) => value.length === 13) || null,
            isbn10: identifiers.find((value: string) => value.length === 10) || null,
            publisher: Array.isArray(edition?.publishers) ? (typeof edition.publishers[0] === 'string' ? edition.publishers[0] : edition.publishers[0]?.name || null) : null,
            publication_year: publicationYear(edition?.publish_date), publication_date: null,
            country: Array.isArray(edition?.publish_country) ? clean(edition.publish_country[0]) || null : clean(edition?.publish_country) || null,
            language: language(Array.isArray(edition?.languages) ? String(edition.languages[0]?.key || '').split('/').pop() : null),
            format: format(edition?.physical_format), binding: format(edition?.physical_format),
            edition_statement: clean(edition?.edition_name) || null, page_count: openLibraryPageCount(edition?.number_of_pages, edition?.pagination),
            cover_url: coverUrl, cover_source: coverUrl ? 'Open Library' : null,
            metadata_source: 'edition_browser_v7_ol', metadata_match_confidence: 'Same Open Library work',
            metadata_payload: { open_library: edition }
          });
        }
        if (rows.length < 50) break;
      }
    }

    const googleQueries = [...new Set([
      ...(selectedIsbn && isValidIsbn(selectedIsbn) ? [`isbn:${selectedIsbn}`] : []),
      `intitle:"${discoveryTitle || title}"${author ? ` inauthor:"${author}"` : ''}`
    ])];
    let googleCount = 0;
    let googleResponded = false;
    const retryAt = Date.parse(stateResult.data.metadata_retry_after || '');
    const googleBackedOff = Number.isFinite(retryAt) && retryAt > Date.now();
    if (googleBackedOff) {
      diagnostics.google_books.rate_limited = true;
      diagnostics.google_books.retry_after_at = stateResult.data.metadata_retry_after;
      diagnostics.google_books.skipped_due_to_rate_limit = googleQueries.length;
    }
    for (const query of googleBackedOff ? [] : googleQueries) {
      const googleUrl = new URL('https://www.googleapis.com/books/v1/volumes');
      googleUrl.searchParams.set('q', query);
      googleUrl.searchParams.set('maxResults', '40');
      googleUrl.searchParams.set('projection', 'full');
      const response = await fetchProviderJson(googleUrl.toString(), 9000, diagnostics, { googleApiKey });
      if (response) googleResponded = true;
      if (response && !Array.isArray(response.items)) recordZeroResult(diagnostics, 'google_books');
      for (const item of Array.isArray(response?.items) ? response.items : []) {
        const volume = item?.volumeInfo || {};
        const authors = Array.isArray(volume.authors) ? volume.authors : [];
        const titleScore = Math.max(similarity(title, volume.title), similarity(discoveryTitle, volume.title), similarity(discoveryTitle, `${volume.title || ''}: ${volume.subtitle || ''}`));
        const authorScore = authorSimilarity(author, authors);
        if (titleScore < .72 || authorScore < .4) continue;
        const isbn13 = cleanIsbn(googleIsbn(volume, 'ISBN_13'));
        const isbn10 = cleanIsbn(googleIsbn(volume, 'ISBN_10'));
        if (!isValidIsbn(isbn13) && !isValidIsbn(isbn10)) continue;
        googleCount += 1;
        const coverUrl = googleCover(volume);
        candidates.push({
          google_books_volume_id: item.id || null, open_library_work_id: workId || null,
          isbn13: isValidIsbn(isbn13) ? isbn13 : null, isbn10: isValidIsbn(isbn10) ? isbn10 : null,
          publisher: volume.publisher || null, publication_year: publicationYear(volume.publishedDate),
          publication_date: /^\d{4}-\d{2}-\d{2}$/.test(String(volume.publishedDate || '')) ? volume.publishedDate : null,
          language: language(volume.language), format: format(volume.printType), binding: null, edition_statement: null,
          page_count: Number(volume.pageCount || 0) || null, cover_url: coverUrl, cover_source: coverUrl ? 'Google Books' : null,
          metadata_source: 'edition_browser_v7_google',
          metadata_match_confidence: `${Math.round((titleScore * .76 + authorScore * .24) * 100)}% match`,
          metadata_payload: { google_books: item }
        });
      }
      if (diagnostics.google_books.rate_limited || googleCount > 0) break;
    }

    const merged = mergeEditionCandidates(candidates);
    let inserted = 0;
    let updated = 0;
    const writeErrors: string[] = [];
    for (const candidate of merged) {
      const match = existing.find((edition: any) => sameEdition(edition, candidate));
      if (match) {
        const patch = buildEditionEnrichmentPatch(match, candidate, new Date().toISOString());
        const update = await admin.from('editions').update(patch).eq('id', match.id);
        if (update.error) writeErrors.push(update.error.message);
        else { Object.assign(match, patch); updated += 1; }
        continue;
      }
      const insert = await admin.from('editions').insert({
        book_id: bookId, owned: false, preferred_copy: false, is_reference: false,
        cover_verified: Boolean(candidate.cover_url), metadata_last_fetched_at: new Date().toISOString(), ...candidate
      }).select('*').single();
      if (insert.error) writeErrors.push(insert.error.message);
      else if (insert.data) { existing.push(insert.data); inserted += 1; }
    }

    const finalResult = await admin.from('editions').select('*').eq('book_id', bookId);
    if (finalResult.error) throw finalResult.error;
    existing = finalResult.data || [];
    knownEditionCount = existing.length;

    let selectedReference: any = null;
    let referenceSaved = false;
    if (shouldAutoSelectReference(book, existing)) {
      selectedReference = chooseReferenceEdition(existing, { workId });
      if (selectedReference) {
        const clearOldReferences = await admin.from('editions').update({ is_reference: false }).eq('book_id', bookId).eq('is_reference', true).eq('owned', false);
        if (clearOldReferences.error) writeErrors.push(clearOldReferences.error.message);
        const markReference = await admin.from('editions').update({ is_reference: true }).eq('id', selectedReference.id);
        if (markReference.error) writeErrors.push(markReference.error.message);
        else referenceSaved = true;
      }
    }

    let status = existing.length > 1 ? 'ready' : existing.length ? 'partial' : 'failed';
    let error = status === 'failed' ? 'No editions could be discovered from Open Library or Google Books.' : status === 'partial' ? 'Only one credible edition is currently known.' : null;
    if (!openLibraryResponded && !googleResponded && existing.length) {
      status = 'partial'; error = 'Edition providers were unavailable; existing editions were preserved.';
    } else if (writeErrors.length) {
      status = existing.length ? 'partial' : 'failed'; error = `Edition metadata was only partially saved: ${writeErrors[0]}`;
    }

    const bookPatch: any = {
      editions_status: status, editions_last_refreshed_at: new Date().toISOString(), editions_error: error
    };
    if (diagnostics.google_books.rate_limited && !googleBackedOff) bookPatch.metadata_retry_after = googleRetryAfter(diagnostics);
    if (selectedReference && referenceSaved) {
      bookPatch.reference_edition_id = selectedReference.id;
      if (!stateResult.data.cover_locked && !stateResult.data.cover_url_preferred && selectedReference.cover_url) {
        bookPatch.cover_url_preferred = selectedReference.cover_url;
        bookPatch.cover_source = selectedReference.cover_source || 'Reference edition';
        bookPatch.cover_verified = Boolean(selectedReference.cover_verified || selectedReference.cover_url);
      }
    }
    const finalBookUpdate = await admin.from('books').update(bookPatch).eq('id', bookId);
    if (finalBookUpdate.error) throw finalBookUpdate.error;

    const sortedFinal = [...existing].sort((left: any, right: any) =>
      Number(Boolean(right.owned)) - Number(Boolean(left.owned))
      || Number(Boolean(right.preferred_copy)) - Number(Boolean(left.preferred_copy))
      || Number(right.publication_year || 0) - Number(left.publication_year || 0)
      || String(left.id).localeCompare(String(right.id))
    );
    return json({
      ok: status !== 'failed', status, count: sortedFinal.length, inserted, updated, work_id: workId, work_source: workSource,
      reference_edition_id: selectedReference?.id || stateResult.data.reference_edition_id || null,
      source_counts: { open_library: openLibraryCount, google_books: googleCount, candidates: merged.length }, provider_diagnostics: diagnostics,
      editions: sortedFinal, message: error
    });
  } catch (error) {
    console.error(error);
    if (admin && bookId) {
      try {
        await admin.from('books').update({
          editions_status: knownEditionCount ? 'partial' : 'failed', editions_last_refreshed_at: new Date().toISOString(),
          editions_error: (error as any)?.message || 'Edition discovery failed'
        }).eq('id', bookId);
      } catch { /* Preserve the original failure. */ }
    }
    return json({ error: (error as any)?.message || 'Edition discovery failed' }, 500);
  }
});
