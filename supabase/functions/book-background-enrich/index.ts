import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Authentication required' }, 401);

    const user = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const userResult = await user.auth.getUser();
    if (userResult.error || !userResult.data.user) return json({ error: 'Invalid session' }, 401);
    const owner = await user.rpc('is_library_owner');
    if (owner.error || owner.data !== true) return json({ error: 'Not authorized' }, 403);

    const body = await request.json();
    const bookId = String(body?.book_id || '');
    const force = body?.force === true;
    if (!bookId) return json({ error: 'book_id required' }, 400);

    const admin = createClient(url, serviceKey);
    const exists = await admin.from('books').select('id').eq('id', bookId).maybeSingle();
    if (exists.error) throw exists.error;
    if (!exists.data) return json({ error: 'Book not found' }, 404);

    const initialState = await admin.from('books').update({
      metadata_status: 'resolving', editions_status: 'refreshing', metadata_error: null, editions_error: null
    }).eq('id', bookId);
    if (initialState.error) throw initialState.error;

    await admin.from('library_events').insert({
      user_id: userResult.data.user.id,
      book_id: bookId,
      event_type: 'background_enrichment_started',
      source: 'frontend',
      payload: { started_at: new Date().toISOString(), order: ['edition-options', 'content-enrichment', 'goodreads-rating-refresh'] }
    });

    const headers = { Authorization: authorization, apikey: anonKey, 'Content-Type': 'application/json' };
    const call = async (slug: string, payload: any) => {
      const startedAt = Date.now();
      try {
        const response = await fetch(`${url}/functions/v1/${slug}`, { method: 'POST', headers, body: JSON.stringify(payload) });
        const data = await response.json().catch(() => null);
        return { slug, ok: response.ok && !data?.error, http_status: response.status, duration_ms: Date.now() - startedAt, data };
      } catch (error) {
        return { slug, ok: false, duration_ms: Date.now() - startedAt, error: (error as any)?.message || String(error) };
      }
    };

    const work = (async () => {
      const results: any[] = [];
      // Edition discovery intentionally precedes content enrichment. Even a partial
      // edition result can provide an ISBN/work identity for the content fallback.
      results.push(await call('edition-options', { book_id: bookId, force }));
      results.push(await call('content-enrichment', { book_id: bookId, force }));
      results.push(await call('goodreads-rating-refresh', { book_id: bookId, force: false }));

      try {
        const [stateResult, libraryResult, editionsResult] = await Promise.all([
          admin.from('books').select('metadata_status,editions_status').eq('id', bookId).single(),
          admin.from('v_library').select('synopsis,cover_url,display_edition_id,isbn13,isbn10,total_pages').eq('id', bookId).single(),
          admin.from('editions').select('id', { count: 'exact', head: true }).eq('book_id', bookId)
        ]);
        const state = stateResult.data || {};
        const visible = libraryResult.data || {};
        const editionCount = editionsResult.count || 0;
        const finalPatch: any = {};
        if (state.editions_status === 'refreshing') {
          finalPatch.editions_status = editionCount ? 'partial' : 'failed';
          finalPatch.editions_last_refreshed_at = new Date().toISOString();
          finalPatch.editions_error = results[0]?.error || results[0]?.data?.error || 'Edition discovery did not finish cleanly.';
        }
        if (state.metadata_status === 'resolving') {
          const hasUsableMetadata = Boolean(visible.synopsis || visible.cover_url || visible.display_edition_id || visible.isbn13 || visible.isbn10 || visible.total_pages);
          finalPatch.metadata_status = hasUsableMetadata ? 'partial' : 'failed';
          finalPatch.metadata_error = results[1]?.error || results[1]?.data?.error || 'Content enrichment did not finish cleanly.';
          finalPatch.metadata_retry_after = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
        }
        if (Object.keys(finalPatch).length) await admin.from('books').update(finalPatch).eq('id', bookId);
      } catch (error) {
        results.push({ slug: 'state-finalizer', ok: false, error: (error as any)?.message || String(error) });
      }

      try {
        await admin.from('library_events').insert({
          user_id: userResult.data.user.id,
          book_id: bookId,
          event_type: 'background_enrichment_finished',
          source: 'background',
          payload: { finished_at: new Date().toISOString(), results }
        });
      } catch (error) {
        console.error('Could not record background enrichment result', error);
      }
    })();

    // Supabase Edge background tasks survive after the HTTP response is returned.
    const runtime: any = (globalThis as any).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(work);
    else await work;
    return json({ ok: true, accepted: true, book_id: bookId, status: 'background' }, 202);
  } catch (error) {
    console.error(error);
    return json({ error: (error as any)?.message || 'Could not start enrichment' }, 500);
  }
});
