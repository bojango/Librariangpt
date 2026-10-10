import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { plannerDb, owner, other, bookId, sessionId } from '../helpers/planner-db.js';

export const timedMigration='supabase/migrations/20261010154251_timed_reading_activity.sql';
const bookmark='40000000-0000-0000-0000-000000000001';
async function setup() {
  const db=await plannerDb();
  for(const file of ['20261001190514_nfc_reading_sessions.sql','20261003055328_active_nfc_reading_sessions.sql','20261003125936_nfc_session_kind.sql','20260909181552_book_quotes_and_passages.sql','20261010110322_private_profile_activity.sql']) await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
  await db.query("insert into public.books(id,title) values($1,'Timer fixture')",[bookId(1)]);
  await db.query("insert into public.library_entries(user_id,book_id,overall_status,current_page,total_pages) values($1,$2,'Currently Reading',0,200)",[owner,bookId(1)]);
  await db.query("insert into public.reading_sessions(id,user_id,book_id,status,started_at,current_page,total_pages) values($1,$2,$3,'Reading','2026-10-01',0,200)",[sessionId,owner,bookId(1)]);
  await db.query("insert into public.nfc_bookmarks(id,user_id,name,token_hash,token_hint) values($1,$2,'Fixture',$3,'hint')",[bookmark,owner,'ab'.repeat(32)]);
  return db;
}
const entries=async db=>(await db.query("select * from public.activity_events where event_type='sessions' order by occurred_at")).rows;

test('timed activity executes the real migrations, classification, backfill and owner-only policies',async t=>{
  const db=await setup();t.after(()=>db.close());
  // Existing completed records exercise the migration's real historical backfill.
  await db.query(`insert into public.reading_time_sessions(user_id,bookmark_id,book_id,reading_session_id,started_at,ended_at,start_page,end_page,session_kind,progress_state,progress_submitted_at)
    values($1,$2,$3,$4,'2026-10-01T10:00Z','2026-10-01T11:12Z',0,30,'reading','submitted','2026-10-02'),
    ($1,$2,$3,$4,'2026-10-01T12:00Z','2026-10-01T12:01Z',0,40,'test','submitted','2026-10-02')`,[owner,bookmark,bookId(1),sessionId]);
  const digest=async()=> (await db.query("select md5(string_agg(row_to_json(s)::text,'' order by id)) digest from public.reading_time_sessions s")).rows[0].digest;
  const before=await digest();
  await db.exec(await readFile(timedMigration,'utf8'));
  assert.equal(await digest(),before);
  assert.equal((await entries(db)).length,1);
  const historical=(await entries(db))[0];
  assert.equal(historical.occurred_at.toISOString(),'2026-10-01T11:12:00.000Z');
  assert.equal(historical.metadata.duration_seconds,4320);assert.equal(historical.metadata.pages_read,30);
  assert.equal((await db.query('select private.backfill_timed_activity() added')).rows[0].added,0);
  assert.equal((await entries(db))[0].id,historical.id);
  const scenario=(name,run)=>t.test(name,async()=>{await db.exec('begin');try{await run();}finally{await db.exec('rollback');}});
  const insertPending=async()=> (await db.query(`insert into public.reading_time_sessions(user_id,bookmark_id,book_id,reading_session_id,started_at,start_page)
    values($1,$2,$3,$4,'2026-10-03T10:00Z',0) returning id`,[owner,bookmark,bookId(1),sessionId])).rows[0].id;
  const finish=async(id,page=null,skip=false)=>db.query('select public.finish_nfc_reading_session($1,$2,$3)',[id,page,skip]);
  await scenario('timer stopping waits for classification and final page entry; repeat saves and later page edits retain event ID/date',async()=>{
    const id=await insertPending();assert.equal((await entries(db)).length,1);
    await db.query("update public.reading_time_sessions set ended_at='2026-10-03T11:12Z' where id=$1",[id]);
    assert.equal((await entries(db)).length,1);
    await db.query("select public.set_nfc_session_kind($1,'reading')",[id]);
    await finish(id,20);await finish(id,25);
    const event=(await entries(db))[1];assert.equal(event.timed_session_id,id);assert.equal(event.metadata.pages_read,20);
    assert.equal(event.occurred_at.toISOString(),'2026-10-03T11:12:00.000Z');
    await db.query('update public.reading_time_sessions set end_page=24 where id=$1',[id]);
    const after=(await entries(db))[1];assert.equal((await entries(db)).length,2);assert.equal(after.id,event.id);assert.equal(after.metadata.pages_read,24);
    assert.equal(after.occurred_at.getTime(),event.occurred_at.getTime());
    await db.query("update public.reading_time_sessions set session_kind='test' where id=$1",[id]);
    assert.equal((await entries(db)).length,1);
  });
  await scenario('late Test classification excludes submitted pages from posts AND canonical reading progress',async()=>{
    const id=await insertPending();await db.query("update public.reading_time_sessions set ended_at='2026-10-03T10:01Z' where id=$1",[id]);
    await db.query("select public.set_nfc_session_kind($1,'test')",[id]);await finish(id,70);
    assert.equal((await entries(db)).length,1);
    assert.equal((await db.query('select current_page from public.reading_sessions where id=$1',[sessionId])).rows[0].current_page,0);
    assert.equal((await db.query('select current_page from public.library_entries')).rows[0].current_page,0);
    assert.equal((await db.query('select count(*)::int n from public.progress_logs')).rows[0].n,0);
    assert.equal((await db.query('select private.backfill_timed_activity() added')).rows[0].added,0);
  });
  await scenario('skipped pages publish a real duration without invented page counts; zero-length timers do not publish',async()=>{
    const id=await insertPending();await db.query("update public.reading_time_sessions set ended_at='2026-10-03T10:42Z' where id=$1",[id]);await finish(id,null,true);
    assert.equal((await entries(db))[1].metadata.pages_read,null);assert.equal((await entries(db))[1].metadata.duration_seconds,2520);
    const zero=await insertPending();await db.query('update public.reading_time_sessions set ended_at=started_at where id=$1',[zero]);await finish(zero,null,true);
    assert.equal((await entries(db)).length,2);
  });
  await scenario('NFC start/stop RPC also publishes only when finalised',async()=>{
    const tap=async()=> (await db.query('select public.tap_nfc_bookmark($1,$2) result',[bookmark,'ab'.repeat(32)])).rows[0].result;
    const started=await tap();await db.query("update public.reading_time_sessions set started_at=clock_timestamp()-interval '42 minutes' where id=$1",[started.session_id]);await db.exec("update public.nfc_bookmarks set last_tapped_at=clock_timestamp()-interval '30 seconds'");
    const stopped=await tap();assert.equal(stopped.status,'ended');assert.equal(stopped.session_id,started.session_id);
    assert.equal((await entries(db)).length,1);await finish(started.session_id,12);
    assert.equal((await entries(db)).length,2);assert.equal((await entries(db))[1].metadata.pages_read,12);
  });
  await scenario('RLS denies anonymous/foreign reads, canonical authoring and direct backfill execution',async()=>{
    const denied=async(query,args,pattern=/permission denied|row-level security/)=>{
      await db.exec('savepoint denied');
      await assert.rejects(db.query(query,args),pattern);
      await db.exec('rollback to savepoint denied; release savepoint denied');
    };
    await db.exec('set local role authenticated');assert.equal((await entries(db)).length,1);
    await denied("insert into public.activity_events(user_id,idempotency_key,event_type,timed_session_id) values($1,'forged','sessions',$2)",[owner,historical.timed_session_id]);
    await denied('select private.backfill_timed_activity()',[]);
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${other}',true); set local role authenticated`);
    assert.equal((await entries(db)).length,0);
    await denied('select public.finish_nfc_reading_session($1,null,true)',[historical.timed_session_id],/Not authorized/);
    await db.exec('reset role; set local role anon');
    await denied('select * from public.activity_events',[]);
    await denied('select private.backfill_timed_activity()',[]);
  });
  await db.exec(await readFile('tests/sql/timed-activity-live.sql','utf8'));
  assert.equal((await entries(db)).length,1);
  assert.equal(await digest(),before);
});
