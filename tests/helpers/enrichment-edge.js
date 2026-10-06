import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

// Run the actual TS handlers with the Supabase/network boundary injected.
// The DB migration tests separately execute real PostgreSQL constraints/RPCs.
export async function edgeHandler(slug, admin) {
  const path = resolve(`supabase/functions/${slug}/index.ts`);
  const source = (await readFile(path,'utf8')).replace(/import \{ createClient \} from 'https:[^']+';/,
    'const createClient = globalThis.__enrichmentTestClient;');
  const compiled = await build({ stdin: { contents: source, resolveDir: dirname(path), loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
  let handler;
  globalThis.__enrichmentTestClient = () => admin;
  globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://db.example', SUPABASE_SERVICE_ROLE_KEY: 'test-service', SUPABASE_ANON_KEY: 'test-anon', ENRICHMENT_SCHEDULER_TOKEN: 'test-scheduler' })[key] }, serve: fn => { handler = fn; } };
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}#${Math.random()}`);
  return async body => {
    const response = await handler(new Request('https://edge.example', { method: 'POST', headers: { Authorization: 'Bearer test-service', 'Content-Type': 'application/json', 'x-enrichment-scheduler-token': 'test-scheduler' }, body: JSON.stringify(body) }));
    return { status: response.status, data: await response.json() };
  };
}

export function memoryAdmin(seed = {}) {
  const tables = { books: [], library_entries: [], editions: [], public_ratings: [], rating_refresh_state: [], book_metadata_candidates: [], enrichment_provider_state: [], book_authors: [], library_events: [], book_enrichment_jobs: [], ...seed };
  const rpcCalls = [];
  const admin = { tables, rpcCalls, from(table) {
    let operation = 'select', payload, options = {}, single = false;
    const filters = [], orders = []; let limit = Infinity;
    const builder = {
      select(_columns, opts = {}) { options = { ...options, ...opts }; return this; },
      eq(key, value) { filters.push(row => row[key] === value); return this; },
      neq(key, value) { filters.push(row => row[key] !== value); return this; },
      ilike(key, value) { filters.push(row => String(row[key]).toLowerCase() === value.toLowerCase()); return this; },
      order(key, opts = {}) { orders.push({ key, ascending: opts.ascending !== false }); return this; },
      limit(value) { limit = value; return this; },
      maybeSingle() { single = true; return this; }, single() { single = true; return this; },
      update(value) { operation = 'update'; payload = value; return this; },
      insert(value) { operation = 'insert'; payload = value; return this; },
      upsert(value, opts = {}) { operation = 'upsert'; payload = value; options = opts; return this; },
      delete() { operation = 'delete'; return this; },
      or(expression) { filters.push(row => expression.split(',').some(term => { const [field, ,value] = term.split('.'); return row[field] === value; })); return this; },
      then(resolvePromise, reject) { return Promise.resolve().then(() => {
        let all = tables[table] || [];
        if (table === 'v_library') all = tables.library_entries.map(entry => {
          const book = tables.books.find(row => row.id === entry.book_id);
          const edition = tables.editions.find(row => row.id === (entry.current_edition_id || book.reference_edition_id)) || {};
          return { ...book, ...entry, id: book.id, authors: book.authors || 'Blake Crouch', display_edition_id: edition.id, isbn13: edition.isbn13, isbn10: edition.isbn10, total_pages: entry.total_pages || edition.page_count, cover_url: edition.cover_url || book.cover_url_preferred };
        });
        let rows = all.filter(row => filters.every(filter => filter(row)));
        if (operation === 'update') rows.forEach(row => Object.assign(row,payload));
        if (operation === 'delete') tables[table] = all.filter(row => !rows.includes(row));
        if (operation === 'insert' || operation === 'upsert') {
          const keys = (options.onConflict || 'id').split(',');
          const existing = operation === 'upsert' && all.find(row => keys.every(key => row[key] === payload[key]));
          if (existing) { if (!options.ignoreDuplicates) Object.assign(existing,payload); rows = [existing]; }
          else { const row = { id: `generated-${all.length}`, ...payload }; all.push(row); tables[table] = all; rows = [row]; }
        }
        for (const {key,ascending} of orders.reverse()) rows.sort((a,b) => String(a[key] || '').localeCompare(String(b[key] || '')) * (ascending ? 1 : -1));
        return { error: null, data: options.head ? null : single ? rows[0] || null : rows.slice(0,limit).map(row=>({...row})), count: rows.length };
      }).then(resolvePromise,reject); }
    };
    return builder;
  }, async rpc(name,args) {
    rpcCalls.push({name,args});
    if (name === 'extend_enrichment_provider_backoff') {
      const existing = tables.enrichment_provider_state.find(row=>row.provider===args.p_provider);
      if (existing) existing.retry_after = [existing.retry_after,args.p_retry_after].sort().at(-1);
      else tables.enrichment_provider_state.push({provider:args.p_provider,retry_after:args.p_retry_after});
      return {data:null,error:null};
    }
    if (name === 'claim_book_enrichment_jobs') return { data: tables.book_enrichment_jobs.filter(row=>row.status==='queued').map(row=>{ row.status='processing'; return {job_id:row.id,book_id:row.book_id,attempt_count:row.attempt_count+1}; }), error: null };
    return {data:true,error:null};
  } };
  return admin;
}
