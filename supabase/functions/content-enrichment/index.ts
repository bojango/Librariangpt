import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  buildEditionEnrichmentPatch,
  chooseReferenceEdition,
  cleanIsbn,
  isCredibleEdition,
  isValidIsbn,
  sameEdition,
  shouldAutoSelectReference
} from '../_shared/edition-ranking.js';

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
const description = (value: any) => {
  const content = clean(typeof value === 'string' ? value : value?.value);
  return content ? (content.length <= 3000 ? content : `${content.slice(0, 2997)}…`) : null;
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

async function fetchJson(url: string, timeoutMs = 8500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ReadingRoom/8.0; +personal-library)', Accept: 'application/json,*/*;q=0.8' }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const googleIsbn = (volume: any, type: string) => volume?.industryIdentifiers?.find((entry: any) => entry?.type === type)?.identifier ?? null;
const googleCover = (volume: any) => {
  const links = volume?.imageLinks || {};
  return [links.extraLarge, links.large, links.medium, links.small, links.thumbnail, links.smallThumbnail].find(Boolean)?.replace(/^http:/, 'https:') || null;
};
const openLibraryWorkId = (value: any) => String(value ?? '').match(/(?:\/works\/)?(OL\d+W)/i)?.[1]?.toUpperCase() || null;
const openLibraryEditionId = (value: any) => String(value ?? '').match(/(?:\/books\/)?(OL\d+M)/i)?.[1]?.toUpperCase() || null;

async function googleSearch(query: string) {
  const url = new URL('https://www.googleapis.com/books/v1/volumes');
  url.searchParams.set('q', query);
  url.searchParams.set('maxResults', '40');
  url.searchParams.set('projection', 'full');
  return fetchJson(url.toString(), 9000);
}

async function googleVolume(id: string) {
  return id ? fetchJson(`https://www.googleapis.com/books/v1/volumes/${encodeURIComponent(id)}`, 7500) : null;
}

function googleCandidate(item: any, title: string, author: string, requestedIsbn = '') {
  const volume = item?.volumeInfo || {};
  const authors = Array.isArray(volume.authors) ? volume.authors : [];
  const isbn13 = cleanIsbn(googleIsbn(volume, 'ISBN_13'));
  const isbn10 = cleanIsbn(googleIsbn(volume, 'ISBN_10'));
  const identifiers = [isbn13, isbn10].filter(isValidIsbn);
  const exact = Boolean(requestedIsbn && identifiers.includes(requestedIsbn));
  const score = exact ? 1 : similarity(title, volume.title) * .76 + authorSimilarity(author, authors) * .24;
  return {
    item, volume, title: volume.title || '', authors,
    isbn13: isValidIsbn(isbn13) ? isbn13 : null,
    isbn10: isValidIsbn(isbn10) ? isbn10 : null,
    exact, score
  };
}

async function upsertRating(admin: any, bookId: string, row: any) {
  if (row?.rating_5 == null || !Number.isFinite(Number(row.rating_5))) return false;
  const payload = {
    book_id: bookId, provider: row.provider, rating_5: Number(row.rating_5),
    rating_count: row.rating_count == null ? null : Number(row.rating_count),
    review_count: row.review_count == null ? null : Number(row.review_count),
    source_url: row.source_url || null, provider_book_id: row.provider_book_id || null,
    is_primary: Boolean(row.is_primary), fetched_at: new Date().toISOString(), notes: row.notes || null
  };
  const { error } = await admin.from('public_ratings').upsert(payload, { onConflict: 'book_id,provider' });
  return !error;
}

async function openLibraryRating(admin: any, bookId: string, workId: string | null) {
  if (!workId) return null;
  const result = await fetchJson(`https://openlibrary.org/works/${encodeURIComponent(workId)}/ratings.json`, 6500);
  const average = Number(result?.summary?.average);
  const count = Number(result?.summary?.count);
  if (!Number.isFinite(average) || !count) return null;
  const row = {
    provider: 'Open Library', rating_5: average, rating_count: count, review_count: null,
    source_url: `https://openlibrary.org/works/${workId}`, provider_book_id: workId,
    is_primary: false, notes: 'Automatically refreshed from Open Library work ratings.'
  };
  await upsertRating(admin, bookId, row);
  return row;
}

function activeEdition(book: any, editions: any[]) {
  const ids = [book.current_edition_id, book.reference_edition_id, book.display_edition_id].filter(Boolean);
  for (const id of ids) {
    const edition = editions.find(row => row.id === id);
    if (edition) return edition;
  }
  return null;
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

  let admin: any;
  let bookId = '';
  let loadedBook: any = null;
  let loadedEditions: any[] = [];
  let originalMetadataStatus: string | null = null;
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Authentication required' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const user = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const userResult = await user.auth.getUser();
    if (userResult.error || !userResult.data.user) return json({ error: 'Invalid session' }, 401);
    const owner = await user.rpc('is_library_owner');
    if (owner.error || owner.data !== true) return json({ error: 'Not authorized' }, 403);
    admin = createClient(url, serviceKey);

    const body = await request.json();
    bookId = String(body?.book_id || '');
    if (!bookId) return json({ error: 'book_id required' }, 400);

    const [bookResult, coreResult, editionsResult] = await Promise.all([
      admin.from('v_library').select('*').eq('id', bookId).single(),
      admin.from('books').select('cover_locked,cover_url_preferred,synopsis,metadata_status,reference_edition_id,original_publication_year,primary_genre,language').eq('id', bookId).single(),
      admin.from('editions').select('*').eq('book_id', bookId)
    ]);
    if (bookResult.error || !bookResult.data) return json({ error: 'Book not found' }, 404);
    if (coreResult.error) throw coreResult.error;
    if (editionsResult.error) throw editionsResult.error;
    loadedBook = { ...bookResult.data, reference_edition_id: coreResult.data.reference_edition_id };
    loadedEditions = editionsResult.data || [];
    originalMetadataStatus = coreResult.data.metadata_status || null;

    const resolving = await admin.from('books').update({ metadata_status: 'resolving', metadata_last_attempted_at: new Date().toISOString(), metadata_error: null }).eq('id', bookId);
    if (resolving.error) throw resolving.error;

    const title = loadedBook.title;
    const author = String(loadedBook.authors || '').split(',')[0].trim();
    const selectedEdition = activeEdition(loadedBook, loadedEditions);
    const existingIsbn = cleanIsbn(selectedEdition?.isbn13 || selectedEdition?.isbn10 || loadedBook.isbn13 || loadedBook.isbn10);
    const queries: string[] = [];
    if (existingIsbn && isValidIsbn(existingIsbn)) queries.push(`isbn:${existingIsbn}`);
    queries.push(`intitle:"${title}"${author ? ` inauthor:"${author}"` : ''}`, `"${title}"${author ? ` "${author}"` : ''}`);

    const [storedVolume, ...googleResults] = await Promise.all([
      googleVolume(String(selectedEdition?.google_books_volume_id || loadedBook.google_books_volume_id || '')),
      ...queries.map(googleSearch)
    ]);
    let candidates: any[] = [];
    if (storedVolume?.volumeInfo) {
      const candidate = googleCandidate(storedVolume, title, author, existingIsbn);
      if (candidate.score >= .58) candidates.push({ ...candidate, score: Math.max(candidate.score, .92) });
    }
    for (const result of googleResults) {
      for (const item of Array.isArray(result?.items) ? result.items : []) {
        const candidate = googleCandidate(item, title, author, existingIsbn);
        if (candidate.title && candidate.score >= .45 && (candidate.isbn13 || candidate.isbn10)) candidates.push(candidate);
      }
    }
    const deduplicated = new Map<string, any>();
    for (const candidate of candidates) {
      const key = candidate.isbn13 || candidate.isbn10 || candidate.item?.id;
      if (!deduplicated.has(key) || candidate.score > deduplicated.get(key).score) deduplicated.set(key, candidate);
    }
    candidates = [...deduplicated.values()].sort((left, right) => right.score - left.score);
    let top = candidates[0] || null;

    let openLibraryEdition: any = null;
    let workId: string | null = selectedEdition?.open_library_work_id
      || loadedEditions.find(edition => edition.open_library_work_id)?.open_library_work_id
      || null;
    if (existingIsbn && isValidIsbn(existingIsbn)) {
      openLibraryEdition = await fetchJson(`https://openlibrary.org/isbn/${encodeURIComponent(existingIsbn)}.json`, 7000);
      workId = workId || openLibraryWorkId(openLibraryEdition?.works?.[0]?.key);
    }

    let fallbackUsed = false;
    let fallbackEdition: any = null;
    if (!top || top.score < .64) {
      fallbackEdition = isCredibleEdition(selectedEdition, workId)
        ? selectedEdition
        : chooseReferenceEdition(loadedEditions, { workId });
      if (fallbackEdition) {
        fallbackUsed = true;
        const fallbackIsbn = cleanIsbn(fallbackEdition.isbn13 || fallbackEdition.isbn10);
        if (fallbackIsbn && isValidIsbn(fallbackIsbn) && fallbackIsbn !== existingIsbn) {
          openLibraryEdition = await fetchJson(`https://openlibrary.org/isbn/${encodeURIComponent(fallbackIsbn)}.json`, 7000);
        }
        workId = fallbackEdition.open_library_work_id || workId || openLibraryWorkId(openLibraryEdition?.works?.[0]?.key);
        top = {
          item: null, volume: {}, isbn13: fallbackEdition.isbn13 || null, isbn10: fallbackEdition.isbn10 || null,
          score: workId ? .86 : .72, fallbackEdition
        };
      }
    }

    let work: any = null;
    if (workId) work = await fetchJson(`https://openlibrary.org/works/${encodeURIComponent(workId)}.json`, 6500);
    const ratingJobs = [openLibraryRating(admin, bookId, workId).catch(() => null)];

    if (!top || top.score < .64) {
      await Promise.allSettled(ratingJobs);
      const hasUsable = Boolean(loadedBook.synopsis || loadedBook.cover_url || loadedBook.display_edition_id || loadedEditions.some(edition => isCredibleEdition(edition)));
      const status = hasUsable && coreResult.data.metadata_status === 'resolved' ? 'resolved' : hasUsable ? 'partial' : 'failed';
      const metadataError = hasUsable
        ? 'Provider refresh could not improve the existing record; valid metadata was preserved.'
        : 'No reliable Google Books/Open Library or discovered-edition match';
      const update = await admin.from('books').update({
        metadata_status: status,
        metadata_retry_after: status === 'resolved' ? null : new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        metadata_error: status === 'resolved' ? null : metadataError
      }).eq('id', bookId);
      if (update.error) throw update.error;
      return json({ ok: hasUsable, status, message: metadataError });
    }

    const volume = top.volume || {};
    const fallback = top.fallbackEdition || fallbackEdition || {};
    const synopsis = loadedBook.synopsis || description(volume.description) || description(work?.description) || null;
    const openLibraryCoverUrl = Array.isArray(openLibraryEdition?.covers) && openLibraryEdition.covers[0]
      ? `https://covers.openlibrary.org/b/id/${openLibraryEdition.covers[0]}-L.jpg?default=false`
      : Array.isArray(work?.covers) && work.covers[0] > 0
        ? `https://covers.openlibrary.org/b/id/${work.covers[0]}-L.jpg?default=false`
        : null;
    const coverUrl = fallback.cover_url || googleCover(volume) || openLibraryCoverUrl || null;
    const pageCount = Number(fallback.page_count || volume.pageCount || openLibraryEdition?.number_of_pages || 0) || null;
    const isbn13 = top.isbn13 || fallback.isbn13 || null;
    const isbn10 = top.isbn10 || fallback.isbn10 || null;
    const candidateEdition = {
      isbn13, isbn10,
      publisher: fallback.publisher || volume.publisher || null,
      publication_year: fallback.publication_year || publicationYear(volume.publishedDate),
      publication_date: fallback.publication_date || (/^\d{4}-\d{2}-\d{2}$/.test(String(volume.publishedDate || '')) ? volume.publishedDate : null),
      language: fallback.language || volume.language || null,
      format: fallback.format || volume.printType || null,
      binding: fallback.binding || null,
      edition_statement: fallback.edition_statement || null,
      page_count: pageCount,
      cover_url: coverUrl,
      cover_source: fallback.cover_source || (googleCover(volume) ? 'Google Books' : openLibraryCoverUrl ? 'Open Library' : null),
      google_books_volume_id: top.item?.id || fallback.google_books_volume_id || null,
      open_library_edition_id: fallback.open_library_edition_id || openLibraryEditionId(openLibraryEdition?.key),
      open_library_work_id: workId,
      metadata_source: fallbackUsed ? 'resolver_v8_edition_fallback' : 'resolver_v8',
      metadata_match_confidence: fallbackUsed ? 'Discovered edition / same work' : `${Math.round(top.score * 100)}% match`,
      metadata_payload: {
        ...(fallback.metadata_payload || {}), google_books: top.item || undefined,
        open_library: openLibraryEdition || undefined, open_library_work: work || undefined
      }
    };

    let editionId = fallback.id || null;
    let matchedEdition = editionId ? loadedEditions.find(edition => edition.id === editionId) : loadedEditions.find(edition => sameEdition(edition, candidateEdition));
    if (matchedEdition) editionId = matchedEdition.id;
    if (!matchedEdition && (isbn13 || isbn10 || candidateEdition.open_library_edition_id || candidateEdition.google_books_volume_id)) {
      const insert = await admin.from('editions').insert({
        book_id: bookId, owned: false, preferred_copy: false, is_reference: false,
        cover_verified: Boolean(coverUrl), metadata_last_fetched_at: new Date().toISOString(), ...candidateEdition
      }).select('*').single();
      if (!insert.error && insert.data) {
        matchedEdition = insert.data;
        loadedEditions.push(insert.data);
        editionId = insert.data.id;
      }
    }
    if (matchedEdition) {
      const patch = buildEditionEnrichmentPatch(matchedEdition, candidateEdition, new Date().toISOString());
      const update = await admin.from('editions').update(patch).eq('id', matchedEdition.id);
      if (update.error) throw update.error;
      Object.assign(matchedEdition, patch);
    }

    let autoReference: any = null;
    if (shouldAutoSelectReference(loadedBook, loadedEditions)) {
      autoReference = chooseReferenceEdition(loadedEditions, { workId });
      if (autoReference) {
        const clear = await admin.from('editions').update({ is_reference: false }).eq('book_id', bookId).eq('is_reference', true).eq('owned', false);
        if (clear.error) throw clear.error;
        const mark = await admin.from('editions').update({ is_reference: true }).eq('id', autoReference.id);
        if (mark.error) throw mark.error;
      }
    }

    const displayEditionAvailable = Boolean(editionId || autoReference || coreResult.data.reference_edition_id || loadedBook.current_edition_id);
    const resolved = displayEditionAvailable && (!fallbackUsed || Boolean(synopsis));
    const status = resolved ? 'resolved' : 'partial';
    const partialMessage = resolved ? null : 'Resolved from a discovered edition; some work-level metadata is still unavailable.';
    const bookPatch: any = {
      metadata_status: status,
      metadata_confidence: top.score,
      metadata_retry_after: resolved ? null : new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      metadata_error: partialMessage,
      metadata_source: fallbackUsed ? 'resolver_v8_edition_fallback' : 'resolver_v8',
      metadata_last_updated: new Date().toISOString().slice(0, 10)
    };
    if (resolved) bookPatch.metadata_resolved_at = new Date().toISOString();
    if (!coreResult.data.synopsis && synopsis) bookPatch.synopsis = synopsis;
    if (!coreResult.data.reference_edition_id && !loadedBook.current_edition_id && loadedBook.ownership_status === 'Not Owned' && autoReference) {
      bookPatch.reference_edition_id = autoReference.id;
    }
    if (!coreResult.data.cover_locked && !coreResult.data.cover_url_preferred && loadedBook.ownership_status === 'Not Owned' && coverUrl) {
      bookPatch.cover_url_preferred = coverUrl;
      bookPatch.cover_source = candidateEdition.cover_source || 'Reference edition';
      bookPatch.cover_verified = true;
    }
    if (!coreResult.data.primary_genre && Array.isArray(volume.categories) && volume.categories[0]) bookPatch.primary_genre = volume.categories[0];
    if (!coreResult.data.language && (volume.language || fallback.language)) bookPatch.language = volume.language || fallback.language;
    const originalYear = publicationYear(work?.first_publish_date || work?.first_publish_year);
    if (!coreResult.data.original_publication_year && originalYear) bookPatch.original_publication_year = originalYear;
    const bookUpdate = await admin.from('books').update(bookPatch).eq('id', bookId);
    if (bookUpdate.error) throw bookUpdate.error;

    if (volume.averageRating != null) {
      await upsertRating(admin, bookId, {
        provider: 'Google Books', rating_5: Number(volume.averageRating), rating_count: volume.ratingsCount ?? null,
        review_count: null, source_url: volume.infoLink || `https://books.google.com/books?id=${top.item?.id || ''}`,
        provider_book_id: top.item?.id || null, is_primary: false, notes: 'Automatically refreshed from Google Books.'
      });
    }
    const ratingResults = await Promise.allSettled(ratingJobs);
    return json({
      ok: true, status, book_id: bookId, edition_id: editionId, reference_edition_id: autoReference?.id || coreResult.data.reference_edition_id || null,
      confidence: top.score, fallback_used: fallbackUsed, isbn13, isbn10, page_count: pageCount,
      cover_url: coverUrl, synopsis: Boolean(synopsis), google_books_volume_id: top.item?.id || null,
      open_library_work_id: workId, ratings_refreshed: ratingResults.map(result => result.status)
    });
  } catch (error) {
    console.error(error);
    if (admin && bookId) {
      try {
        const hasUsable = Boolean(loadedBook?.synopsis || loadedBook?.cover_url || loadedBook?.display_edition_id || loadedEditions.some(edition => isCredibleEdition(edition)));
        const preserveResolved = hasUsable && originalMetadataStatus === 'resolved';
        await admin.from('books').update({
          metadata_status: preserveResolved ? 'resolved' : hasUsable ? 'partial' : 'failed',
          metadata_error: preserveResolved ? null : (error as any)?.message || 'Content enrichment failed',
          metadata_retry_after: preserveResolved ? null : new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
        }).eq('id', bookId);
      } catch { /* Preserve the original failure. */ }
    }
    return json({ error: (error as any)?.message || 'Content enrichment failed' }, 500);
  }
});
