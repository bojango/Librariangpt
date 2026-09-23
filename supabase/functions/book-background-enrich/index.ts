import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-enrichment-scheduler-token',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const RETRY_MS = 6 * 60 * 60 * 1000;

type Caller = { service: boolean; userId?: string; authorization: string };

async function authorise(request: Request, url: string, anonKey: string, serviceKey: string): Promise<Caller | null> {
  const authorization = request.headers.get('Authorization') || '';
  const apiKey = request.headers.get('apikey') || '';
  const schedulerToken = Deno.env.get('ENRICHMENT_SCHEDULER_TOKEN') || '';
  const suppliedSchedulerToken = request.headers.get('x-enrichment-scheduler-token') || '';
  const serviceCredential = authorization === `Bearer ${serviceKey}` || apiKey === serviceKey;
  if (serviceCredential && (!suppliedSchedulerToken || suppliedSchedulerToken === schedulerToken)) {
    return { service: true, authorization: `Bearer ${serviceKey}` };
  }
  if (!authorization) return null;
  const user = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const userResult = await user.auth.getUser();
  if (userResult.error || !userResult.data.user) return null;
  const owner = await user.rpc('is_library_owner');
  if (owner.error || owner.data !== true) return null;
  return { service: false, userId: userResult.data.user.id, authorization };
}

async function libraryUserId(admin: any, bookId: string, supplied?: string) {
  if (supplied) return supplied;
  const result = await admin.from('library_entries').select('user_id').eq('book_id', bookId).limit(1).maybeSingle();
  return result.data?.user_id || null;
}

async function recordEvent(admin: any, userId: string | null, bookId: string, eventType: string, source: string, payload: any) {
  if (!userId) return;
  const result = await admin.from('library_events').insert({ user_id: userId, book_id: bookId, event_type: eventType, source, payload });
  if (result.error) console.error(`Could not record ${eventType}`, result.error);
}

function retryAt(value: unknown) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) && timestamp > Date.now()
    ? new Date(timestamp).toISOString()
    : new Date(Date.now() + RETRY_MS).toISOString();
}

async function finishJob(admin: any, jobId: string, state: any, results: any[]) {
  const complete = ['resolved', 'manual'].includes(state?.metadata_status);
  const patch: any = {
    status: complete ? 'completed' : 'retry',
    locked_at: null,
    completed_at: complete ? new Date().toISOString() : null,
    available_at: complete ? new Date().toISOString() : retryAt(state?.metadata_retry_after),
    last_error: complete ? null : state?.metadata_error || 'Metadata enrichment remains partial.',
    last_result: { metadata_status: state?.metadata_status || null, editions_status: state?.editions_status || null, results }
  };
  const update = await admin.from('book_enrichment_jobs').update(patch).eq('id', jobId);
  if (update.error) console.error('Could not finalise enrichment queue job', update.error);
}

async function failJob(admin: any, job: any, error: unknown) {
  const state = await admin.from('books').select('metadata_retry_after').eq('id', job.book_id).maybeSingle();
  const update = await admin.from('book_enrichment_jobs').update({
    status: 'retry', locked_at: null, completed_at: null,
    available_at: retryAt(state.data?.metadata_retry_after),
    last_error: (error as any)?.message || String(error),
    last_result: { failed_at: new Date().toISOString() }
  }).eq('id', job.job_id);
  if (update.error) console.error('Could not persist enrichment queue failure', update.error);
}

async function enrichBook(admin: any, url: string, anonKey: string, serviceKey: string, caller: Caller, job: any, force: boolean) {
  const bookId = String(job.book_id);
  const source = caller.service ? 'scheduler' : 'frontend';
  const exists = await admin.from('books').select('id,editions_status').eq('id', bookId).maybeSingle();
  if (exists.error) throw exists.error;
  if (!exists.data) throw new Error('Book not found');

  const initialPatch: any = { metadata_status: 'resolving', metadata_error: null };
  if (exists.data.editions_status !== 'ready') {
    initialPatch.editions_status = 'refreshing';
    initialPatch.editions_error = null;
  }
  const initialState = await admin.from('books').update(initialPatch).eq('id', bookId);
  if (initialState.error) throw initialState.error;

  const userId = await libraryUserId(admin, bookId, caller.userId);
  await recordEvent(admin, userId, bookId, 'background_enrichment_started', source, {
    started_at: new Date().toISOString(), queue_job_id: job.job_id,
    order: ['edition-options', 'goodreads-rating-refresh', 'content-enrichment']
  });

  const headers = caller.service
    ? { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' }
    : { Authorization: caller.authorization, apikey: anonKey, 'Content-Type': 'application/json' };
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

  const results: any[] = [];
  results.push(await call('edition-options', { book_id: bookId, force }));
  results.push(await call('goodreads-rating-refresh', { book_id: bookId, force: false }));
  const goodreadsResult = results[1]?.data?.results?.[0];
  const goodreadsSeeded = Boolean(goodreadsResult?.identity_seeded || goodreadsResult?.rating?.identity_seeded);
  if (goodreadsSeeded) results.push(await call('edition-options', { book_id: bookId, force: true }));
  results.push(await call('content-enrichment', { book_id: bookId, force }));

  const [stateResult, libraryResult, editionsResult] = await Promise.all([
    admin.from('books').select('metadata_status,metadata_retry_after,metadata_error,editions_status').eq('id', bookId).single(),
    admin.from('v_library').select('synopsis,cover_url,display_edition_id,isbn13,isbn10,total_pages').eq('id', bookId).maybeSingle(),
    admin.from('editions').select('id', { count: 'exact', head: true }).eq('book_id', bookId)
  ]);
  if (stateResult.error) throw stateResult.error;
  const state = stateResult.data || {};
  const visible = libraryResult.data || {};
  const finalPatch: any = {};
  if (state.editions_status === 'refreshing') {
    finalPatch.editions_status = editionsResult.count ? 'partial' : 'failed';
    finalPatch.editions_last_refreshed_at = new Date().toISOString();
    finalPatch.editions_error = results[0]?.error || results[0]?.data?.error || 'Edition discovery did not finish cleanly.';
  }
  if (state.metadata_status === 'resolving') {
    const hasUsableMetadata = Boolean(visible.synopsis || visible.cover_url || visible.display_edition_id || visible.isbn13 || visible.isbn10 || visible.total_pages);
    const content = results.find(result => result.slug === 'content-enrichment');
    finalPatch.metadata_status = hasUsableMetadata ? 'partial' : 'failed';
    finalPatch.metadata_error = content?.error || content?.data?.error || 'Content enrichment did not finish cleanly.';
    finalPatch.metadata_retry_after = new Date(Date.now() + RETRY_MS).toISOString();
  }
  if (Object.keys(finalPatch).length) {
    const finalState = await admin.from('books').update(finalPatch).eq('id', bookId).select('metadata_status,metadata_retry_after,metadata_error,editions_status').single();
    if (finalState.error) throw finalState.error;
    Object.assign(state, finalState.data);
  }

  await finishJob(admin, job.job_id, state, results);
  await recordEvent(admin, userId, bookId, 'background_enrichment_finished', source, {
    finished_at: new Date().toISOString(), queue_job_id: job.job_id, results
  });
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const caller = await authorise(request, url, anonKey, serviceKey);
    if (!caller) return json({ error: 'Not authorized' }, 401);
    const body = await request.json().catch(() => ({}));
    const bookId = body?.book_id ? String(body.book_id) : null;
    const force = body?.force === true;
    if (!bookId && !caller.service) return json({ error: 'book_id required' }, 400);

    const admin = createClient(url, serviceKey);
    if (bookId) {
      const queued = await admin.from('book_enrichment_jobs').upsert({ book_id: bookId }, { onConflict: 'book_id', ignoreDuplicates: true });
      if (queued.error) throw queued.error;
    }
    const requested = Number(body?.batch_size || 2);
    const batchSize = bookId ? 1 : Math.min(4, Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 2));
    const claimed = await admin.rpc('claim_book_enrichment_jobs', { p_limit: batchSize, p_book_id: bookId, p_force: force });
    if (claimed.error) throw claimed.error;
    const jobs = claimed.data || [];
    if (!jobs.length) return json({ ok: true, accepted: false, status: 'not_due_or_already_processing', book_id: bookId }, 202);

    const work = (async () => {
      for (const job of jobs) {
        try { await enrichBook(admin, url, anonKey, serviceKey, caller, job, force); }
        catch (error) { console.error(error); await failJob(admin, job, error); }
      }
    })();
    const runtime: any = (globalThis as any).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(work);
    else await work;
    return json({ ok: true, accepted: true, queued: jobs.length, book_ids: jobs.map((job: any) => job.book_id), status: 'background' }, 202);
  } catch (error) {
    console.error(error);
    return json({ error: (error as any)?.message || 'Could not start enrichment' }, 500);
  }
});
