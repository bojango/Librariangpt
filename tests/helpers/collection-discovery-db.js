import {readFile} from 'node:fs/promises';
import {enrichmentDb} from './enrichment-db.js';
import {owner} from './planner-db.js';
export const collectionMigration='supabase/migrations/20261026101841_collection_discovery_backend.sql';
export async function discoveryDb(snapshot={books:[],series:[],book_series:[]}) {
  const db=await enrichmentDb();
  await db.exec("create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$");
  for(const b of snapshot.books) {
    await db.query('insert into public.books(id,title,original_publication_year,cover_url_preferred) values($1,$2,$3,$4)',[b.id,b.title,b.original_publication_year,b.cover_url_preferred]);
    for(const [i,name] of b.authors.split(',').map(s=>s.trim()).filter(Boolean).entries()) {
      await db.query('insert into public.authors(name) values($1) on conflict(name) do nothing',[name]);
      await db.query('insert into public.book_authors(book_id,author_id,author_order) select $1,id,$3 from public.authors where name=$2',[b.id,name,i+1]);
    }
    for(const e of b.editions || []) await db.query('insert into public.editions(id,book_id,isbn13,isbn10,open_library_work_id,open_library_edition_id,metadata_payload) values($1,$2,$3,$4,$5,$6,$7)',[e.id,b.id,e.isbn13,e.isbn10,e.open_library_work_id,e.open_library_edition_id,JSON.stringify(e.metadata_payload || {})]);
    for(const e of b.external_ids || []) await db.query('insert into public.book_external_ids(book_id,provider,external_id,url) values($1,$2,$3,$4)',[b.id,e.provider,e.external_id,e.url]);
  }
  for(const s of snapshot.series) await db.query('insert into public.series(id,name) values($1,$2)',[s.id,s.name]);
  for(const m of snapshot.book_series) await db.query('insert into public.book_series(book_id,series_id,series_order) values($1,$2,$3)',[m.book_id,m.series_id,m.series_order]);
  if(snapshot.books.some(b=>b.library_entry)) {
    await db.query('insert into auth.users(id) values($1)',[owner]);
    await db.query('update private.app_state set owner_user_id=$1',[owner]);
    for(const b of snapshot.books) if(b.library_entry) await db.query('insert into public.library_entries(user_id,book_id,overall_status,ownership_status) values($1,$2,$3,$4)',[owner,b.id,b.library_entry.overall_status,b.library_entry.ownership_status]);
  }
  await db.exec(await readFile('supabase/migrations/20261020205229_collections_reading_paths.sql','utf8'));
  await db.exec(await readFile('supabase/seeds/collections-verified.sql','utf8'));
  await db.exec(await readFile(collectionMigration,'utf8'));
  await db.exec(await readFile('supabase/migrations/20261026154708_collection_discovery_automation_hardening.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/20261026191301_requeue_verified_collection_retries.sql','utf8'));
  return db;
}
export async function finish(db,job,result,error=null,retryAfter=null) {
  return (await db.query('select public.finish_collection_discovery($1,$2,$3,$4,$5,$6) ok',[job.book_id,job.claim_token,job.revision,JSON.stringify(result),error,retryAfter])).rows[0].ok;
}
