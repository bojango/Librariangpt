// deno-lint-ignore-file no-import-prefix no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { chapterRows, editionId, editionPageCount, selectSafeAlternate, usableToc, workId } from './core.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json' },
});
const now = () => performance.now();

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { 'User-Agent': 'Library/2.0 personal reading tracker' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`provider_${response.status}`);
  return await response.json();
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

  const startedAt = now();
  let admin: any = null;
  let attemptedEditionId: string | null = null;
  let attemptedBookId: string | null = null;
  const log = async (outcome: string, metadata: Record<string, unknown> = {}, errorCode: string | null = null) => {
    if (!admin) return;
    try {
      await admin.from('reading_system_events').insert({
        component: 'chapter-map', action: 'map', outcome,
        error_code: errorCode, duration_ms: Math.max(0, Math.round(now() - startedAt)),
        book_id: attemptedBookId, edition_id: attemptedEditionId, metadata,
      });
    } catch {
      // Diagnostics must never decide whether chapter mapping succeeds.
    }
  };

  try {
    const auth = request.headers.get('Authorization');
    if (!auth) return json({ error: 'Authentication required' }, 401);
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const user = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const userData = await user.auth.getUser();
    if (userData.error || !userData.data.user) return json({ error: 'Invalid session' }, 401);
    const owner = await user.rpc('is_library_owner');
    if (owner.error || owner.data !== true) return json({ error: 'Not authorized' }, 403);

    const body = await request.json();
    const bookId = String(body?.book_id || '');
    const force = body?.force === true;
    if (!bookId) return json({ error: 'book_id required' }, 400);
    attemptedBookId = bookId;
    admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    const query = await admin.from('v_library').select(
      'id,title,language,current_page,total_pages,display_edition_id,isbn10,isbn13,publisher,imprint,edition_year,edition_page_count,open_library_edition_id,open_library_work_id',
    ).eq('id', bookId).single();
    if (query.error || !query.data) return json({ error: 'Book not found' }, 404);
    const book = query.data;
    if (!book.display_edition_id) return json({ error: 'No displayed edition' }, 400);
    attemptedEditionId = book.display_edition_id;

    const existing = await admin.from('edition_chapters').select('*').eq('edition_id', attemptedEditionId).order('sequence_no');
    if (!force && (existing.data?.length || 0) > 0) {
      const current = (existing.data || []).filter((row: any) => book.current_page != null && row.start_page <= book.current_page)
        .sort((left: any, right: any) => right.start_page - left.start_page || right.level - left.level)[0] || null;
      return json({ ok: true, cached: true, imported: existing.data?.length || 0, current_chapter: current });
    }

    let openLibraryEditionId = book.open_library_edition_id || null;
    const isbn = book.isbn13 || book.isbn10;
    if (!openLibraryEditionId && isbn) {
      const isbnRecord = await fetchJson(`https://openlibrary.org/isbn/${encodeURIComponent(isbn)}.json`);
      openLibraryEditionId = editionId(isbnRecord);
    }
    if (!openLibraryEditionId) {
      await admin.from('editions').update({ chapter_map_source: 'Open Library', chapter_map_status: 'not_found', chapter_map_last_checked_at: new Date().toISOString() }).eq('id', attemptedEditionId);
      await log('not_found', { candidate_count_inspected: 0 });
      return json({ ok: true, imported: 0, status: 'not_found' });
    }

    let exactEdition: any = null;
    try {
      exactEdition = await fetchJson(`https://openlibrary.org/books/${encodeURIComponent(openLibraryEditionId)}.json`);
    } catch {
      await log('exact_fetch_failed', { requested_open_library_edition_id: openLibraryEditionId }, 'provider_fetch_failed');
    }

    if (exactEdition) {
      const exactToc = usableToc(exactEdition);
      if (exactToc.usable) {
        const rows = chapterRows(exactToc.rows, { editionId: attemptedEditionId, sourceEditionId: openLibraryEditionId });
        if (force) await admin.from('edition_chapters').delete().eq('edition_id', attemptedEditionId).eq('source', 'open_library');
        const inserted = await admin.from('edition_chapters').upsert(rows, { onConflict: 'edition_id,sequence_no' }).select('*');
        if (inserted.error) throw inserted.error;
        const status = rows.length < exactToc.tocCount ? 'partial' : 'available';
        await admin.from('editions').update({
          open_library_edition_id: openLibraryEditionId, open_library_work_id: workId(exactEdition) || book.open_library_work_id,
          chapter_map_source: 'Open Library', chapter_map_status: status, chapter_map_last_checked_at: new Date().toISOString(),
        }).eq('id', attemptedEditionId);
        await log('exact_success', {
          requested_open_library_edition_id: openLibraryEditionId, exact_edition_page_count: book.edition_page_count || book.total_pages,
          imported_row_count: rows.length, matching_reason: 'exact_edition',
        });
        await log(status, { imported_row_count: rows.length, matching_reason: 'exact_edition' });
        const current = rows.filter((row: any) => book.current_page != null && row.start_page <= book.current_page)
          .sort((left: any, right: any) => right.start_page - left.start_page || right.level - left.level)[0] || null;
        return json({ ok: true, imported: rows.length, status, current_chapter: current });
      }
      await log('exact_no_toc', {
        requested_open_library_edition_id: openLibraryEditionId, exact_edition_page_count: book.edition_page_count || book.total_pages,
      });
    }

    const associatedWorkId = workId(exactEdition) || book.open_library_work_id || null;
    let candidates: any[] = [];
    if (associatedWorkId) {
      try {
        const response = await fetchJson(`https://openlibrary.org/works/${encodeURIComponent(associatedWorkId)}/editions.json?limit=200`);
        candidates = Array.isArray(response?.entries) ? response.entries : [];
      } catch {
        await log('alternate_fetch_failed', {
          requested_open_library_edition_id: openLibraryEditionId, candidate_count_inspected: 0,
        }, 'provider_fetch_failed');
        throw new Error('alternate_fetch_failed');
      }
    }

    const selection = selectSafeAlternate({
      requested: {
        title: book.title, language: book.language, publisher: book.publisher, imprint: book.imprint,
        publication_year: book.edition_year, page_count: book.edition_page_count || book.total_pages,
        open_library_edition_id: openLibraryEditionId,
      },
      exactEdition, candidates, expectedWorkId: associatedWorkId,
    });

    if (selection.candidate) {
      const sourceEditionId = editionId(selection.candidate)!;
      const rows = chapterRows(selection.rows, { editionId: attemptedEditionId, sourceEditionId });
      if (force) await admin.from('edition_chapters').delete().eq('edition_id', attemptedEditionId).eq('source', 'open_library');
      const inserted = await admin.from('edition_chapters').upsert(rows, { onConflict: 'edition_id,sequence_no' }).select('*');
      if (inserted.error) throw inserted.error;
      const sourceTocCount = Array.isArray(selection.candidate.table_of_contents) ? selection.candidate.table_of_contents.length : selection.rows.length;
      const status = rows.length < sourceTocCount ? 'partial' : 'available';
      await admin.from('editions').update({
        open_library_edition_id: openLibraryEditionId, open_library_work_id: associatedWorkId,
        chapter_map_source: 'Open Library compatible edition', chapter_map_status: status, chapter_map_last_checked_at: new Date().toISOString(),
      }).eq('id', attemptedEditionId);
      await log('alternate_success', {
        requested_open_library_edition_id: openLibraryEditionId, candidate_open_library_edition_id: sourceEditionId,
        exact_edition_page_count: book.edition_page_count || book.total_pages,
        candidate_page_count: editionPageCount(selection.candidate),
        imported_row_count: rows.length, candidate_count_inspected: selection.candidateCountInspected,
        matching_reason: selection.matchingReason,
      });
      await log(status, { imported_row_count: rows.length, matching_reason: selection.matchingReason });
      const current = rows.filter((row: any) => book.current_page != null && row.start_page <= book.current_page)
        .sort((left: any, right: any) => right.start_page - left.start_page || right.level - left.level)[0] || null;
      return json({ ok: true, imported: rows.length, status, current_chapter: current });
    }

    await log('alternate_no_safe_match', {
      requested_open_library_edition_id: openLibraryEditionId,
      exact_edition_page_count: book.edition_page_count || book.total_pages,
      candidate_count_inspected: selection.candidateCountInspected,
      toc_candidate_count: selection.tocCandidateCount,
    });
    await admin.from('editions').update({
      open_library_edition_id: openLibraryEditionId, open_library_work_id: associatedWorkId,
      chapter_map_source: 'Open Library', chapter_map_status: 'not_found', chapter_map_last_checked_at: new Date().toISOString(),
    }).eq('id', attemptedEditionId);
    await log('not_found', { candidate_count_inspected: selection.candidateCountInspected, toc_candidate_count: selection.tocCandidateCount });
    return json({ ok: true, imported: 0, status: 'not_found' });
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Chapter mapping failed');
    if (admin && attemptedEditionId) {
      await admin.from('editions').update({
        chapter_map_source: 'Open Library', chapter_map_status: 'failed', chapter_map_last_checked_at: new Date().toISOString(),
      }).eq('id', attemptedEditionId);
      await log('failed', {}, 'temporarily_unavailable');
    }
    return json({ error: 'Chapter mapping temporarily unavailable' }, 500);
  }
});
