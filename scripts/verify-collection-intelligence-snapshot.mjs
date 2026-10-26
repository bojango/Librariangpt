import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {discoveryDb} from '../tests/helpers/collection-discovery-db.js';
import {createHash} from 'node:crypto';
const snapshot=JSON.parse(await readFile('output/collection-intelligence/snapshot.json','utf8'));
const db=await discoveryDb(snapshot);
try{
 await db.exec(await readFile('supabase/migrations/20260908080146_ai_recommendation_shelf.sql','utf8'));
 // The legacy fixture predates the deployed NFC source value. This constraint
 // belongs to an unrelated migration; the new migration never changes it.
 await db.exec('alter table public.progress_logs drop constraint progress_logs_source_check');
 if(!(await db.query('select 1 from auth.users where id=$1',[snapshot.owner])).rows.length)await db.query('insert into auth.users(id) values($1)',[snapshot.owner]);
 await db.query('update private.app_state set owner_user_id=$1',[snapshot.owner]);
 // Restore source-backed catalogue rows and protected reader rows into isolated
 // PostgreSQL. Filter by actual fixture-schema columns, explicitly record them.
 await db.exec('delete from collection_memberships;delete from collections;delete from collection_catalogue_books;');
 const restored={};
 const order=['collection_catalogue_books','collections','collection_memberships','library_entries','recommendations','reading_paths','reading_path_entries','reading_sessions','reading_feedback','taste_profile','taste_evidence','progress_logs'];
 for(const name of order){
  const available=(await db.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1 and is_generated='NEVER'",[name])).rows.map(r=>r.column_name);
  restored[name]={rows:snapshot.tables[name].length,columns:available};
  for(const row of snapshot.tables[name]){
   const columns=Object.keys(row).filter(k=>available.includes(k));
   // No edition restoration is needed to test additive preservation; FK-only
   // edition references are null in this isolated copy, and are recorded here.
   const omitted=['current_edition_id','edition_id','reference_edition_id'];
   const values=columns.map(k=>omitted.includes(k)?null:row[k]&&typeof row[k]==='object'&&!Array.isArray(row[k])?JSON.stringify(row[k]):row[k]);
   await db.query(`insert into public.${name}(${columns.join(',')}) overriding system value values(${columns.map((_,i)=>`$${i+1}`).join(',')}) on conflict do nothing`,values);
  }
 }
 const protectedTables=order.slice(3);
 const fingerprint=async()=>{const out={};for(const name of protectedTables)out[name]=createHash('sha256').update(JSON.stringify((await db.query(`select to_jsonb(t) row from ${name} t order by to_jsonb(t)::text`)).rows)).digest('hex');return out;};
 const before=await fingerprint();await db.exec(await readFile('supabase/migrations/20261026210308_catalogue_enrichment_assessments.sql','utf8'));await db.exec(await readFile('supabase/migrations/20261026212754_catalogue_source_evidence.sql','utf8'));await db.query('select reconcile_collection_intelligence()');const after=await fingerprint();
 assert.deepEqual(before,after);
 const counts=(await db.query('select (select count(*) from collection_catalogue_books)::int works,(select count(*) from catalogue_enrichment_jobs)::int metadata_jobs,(select count(*) from collection_assessments)::int assessments')).rows[0];
 assert.equal(counts.works,snapshot.tables.collection_catalogue_books.length);assert.equal(counts.assessments,counts.works);assert.equal(counts.metadata_jobs,counts.works);
 const report={verified_at:new Date().toISOString(),counts,protected_fingerprints_unchanged:true,before,after,restored,edition_fk_values:'null in isolated copy only; not changed in production',hosted_extensions:'cron/net stubbed by test harness; live smoke required'};
 await writeFile('output/collection-intelligence/isolated-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify({counts,protected_fingerprints_unchanged:true}));
}finally{await db.close();}
