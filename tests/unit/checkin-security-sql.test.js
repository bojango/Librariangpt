import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { enrichmentDb } from '../helpers/enrichment-db.js';

test('separate check-in hotfix denies untrusted execution and preserves real service/owner writes',async t=>{
 const db=await enrichmentDb();t.after(()=>db.close());
 for(const file of ['20260908080146_ai_recommendation_shelf.sql','20260907145038_add_edition_chapter_mapping.sql','20260907184340_add_up_next_queue.sql','20260913171316_add_reading_card_notes_and_chapter_orchestration.sql','20260913180154_add_reading_checkin_bridge_rpcs.sql']){
  // This fixture already has a newer chapter view; test the unchanged RPCs
  // without replaying the superseded presentation-view definition.
  let sql=await readFile(`supabase/migrations/${file}`,'utf8');
  if(file.includes('orchestration'))sql=sql.replace(/create or replace view public\.v_library_chapters[\s\S]*?;/gi,'');
  await db.exec(sql);
 }
 await db.exec(await readFile('tests/fixtures/reading-checkin-event-production.sql','utf8'));
 await db.exec('grant execute on function public.record_reading_checkin_bridge(uuid,uuid,text,integer,integer,text) to authenticated,service_role;');
 const uid='10000000-0000-0000-0000-000000000001';
 await db.exec(`insert into auth.users values('${uid}');update private.app_state set owner_user_id='${uid}';`);
 const book=(await db.query("insert into books(title) values('Isolated check-in fixture') returning id")).rows[0].id;
 await db.query('insert into library_entries(user_id,book_id,current_page,total_pages) values($1,$2,20,200)',[uid,book]);
 const call=()=>db.query("select record_reading_checkin_bridge($1,null,'chapter',20,200,'Isolated test') result",[book]);
 // Reproduce the original unauthorised write against the actual deployed body.
 await db.exec('set role anon');assert.equal((await call()).rows[0].result.saved,true);await db.exec('reset role');
 const sql=await readFile('supabase/migrations/20261009202447_secure_reading_checkin_bridge.sql','utf8');
 await db.exec(sql);await db.exec(sql); // Repeatable; no body or history modification.
 const before=(await db.query('select count(*) n from library_events')).rows[0].n;
 for(const role of ['anon','authenticated']){
  await db.exec(`set role ${role}`);await assert.rejects(call(),/permission denied for function/);await db.exec('reset role');
 }
 assert.equal((await db.query('select count(*) n from library_events')).rows[0].n,before);
 await db.exec('set role service_role');
 assert.equal((await db.query('select reading_checkin_bridge_snapshot() result')).rows[0].result.state.current_book,null);
 assert.equal((await call()).rows[0].result.reason,'duplicate_page_checkin');
 assert.equal((await db.query("select record_reading_checkin_bridge($1,null,'chapter',30,200,'Service test') result",[book])).rows[0].result.saved,true);
 await db.exec('reset role');
 await db.query("update library_entries set overall_status='Currently Reading' where book_id=$1",[book]);
 await db.query("insert into reading_sessions(user_id,book_id,status,current_page,total_pages) values($1,$2,'Reading',20,200)",[uid,book]);
 await db.exec('set role service_role');
 const note=(await db.query("select save_reading_card_note_bridge('Isolated service bridge test',$1,20,10,null,null) result",[book])).rows[0].result;
 assert.equal(note.saved,true,JSON.stringify(note));
 assert.equal((await db.query('select reading_checkin_bridge_snapshot() result')).rows[0].result.state.current_book.book_id,book);
 await db.exec('reset role');
 assert.equal((await db.query("select record_reading_checkin_bridge($1,null,'chapter',40,200,'Owner test') result",[book])).rows[0].result.saved,true);
 const entry=(await db.query('select current_page,total_pages from library_entries where book_id=$1',[book])).rows[0];
 assert.deepEqual(entry,{current_page:20,total_pages:200});
});
