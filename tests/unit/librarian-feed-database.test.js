import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {reflectionsDb,addFeedback,candidates,publish,owner,other,bookId,sessionId} from '../helpers/librarian-feed-db.js';

test('discovery is read-only, baselines history and detects saved conversation feedback, not timers or questions',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());
  const missing=(await db.query(`select count(*) n from pg_constraint c where c.contype='f' and c.connamespace='private'::regnamespace
    and c.conrelid::regclass::text like 'private.librarian_feed_%' and not exists(select 1 from pg_index i where i.indrelid=c.conrelid and i.indkey[0]=c.conkey[1])`)).rows[0].n;
  assert.equal(missing,0);
  assert.deepEqual(await candidates(db),[]);
  await db.exec("update reading_feedback set confidence='Medium',updated_at=now();update reading_sessions set current_page=110;");
  await addFeedback(db,{text:'Rating: 4/5'});await addFeedback(db,{text:'Great book.'});await addFeedback(db,{addedBy:'test',text:'This is only a synthetic timer quality assurance comment.'});
  assert.deepEqual(await candidates(db),[]);
  const id=await addFeedback(db,{});const first=(await candidates(db))[0];
  assert.equal(first.book_id,bookId(1));assert.equal(first.book.title,'Editorial fixture');assert.equal(first.session_id,sessionId);
  assert.equal(first.reader,'Calum');assert.equal(first.reading_context.page,110);assert.equal(first.new_feedback.length,1);assert.equal(first.new_feedback[0].id,id);
  assert.equal(first.previous_feedback[0].sentiment,'Negative');
  assert.deepEqual(await candidates(db),[first]);
  assert.equal((await db.query('select count(*) n from private.librarian_feed_receipts')).rows[0].n,0);
  await db.exec('begin read only');assert.equal((await candidates(db))[0].candidate_id,first.candidate_id);await db.exec('rollback');
  await db.exec("set timezone='Pacific/Auckland';update reading_feedback set updated_at=clock_timestamp() where id='"+id+"';");
  assert.equal((await candidates(db))[0].candidate_id,first.candidate_id);
  await db.exec("set timezone='UTC';");
});

test('publish commits feed, evidence and audit together; retries are idempotent even after daily throttling',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());await addFeedback(db,{});const c=(await candidates(db))[0];
  const r=await publish(db,c);assert.equal(r.status,'published');assert.deepEqual(await candidates(db),[]);
  const retry=await publish(db,c);assert.equal(retry.status,'already_published');assert.equal(retry.event_id,r.event_id);
  await assert.rejects(publish(db,c,{text:'Calum found this a different observation which was never originally sent.'}),/different request/);
  const event=(await db.query('select * from activity_events where id=$1',[r.event_id])).rows[0];
  assert.equal(event.event_type,'librarian');assert.equal(event.source,'automation');assert.equal(event.book_id,bookId(1));assert.equal(event.session_id,sessionId);
  assert.equal(event.metadata.feedback_ids[0],c.new_feedback[0].id);assert.equal(event.metadata.evidence[0].user_feedback,c.new_feedback[0].user_feedback);assert(event.hashtags.includes('librarian'));
  assert.equal((await db.query("select count(*) n from private.librarian_feed_evidence where disposition='published'")).rows[0].n,1);
  assert.deepEqual((await db.query('select result from private.librarian_feed_audit order by id')).rows.map(r=>r.result),['published','retry']);
});

test('daily routine limit defers new evidence without consuming it, then becomes eligible the next day',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());await addFeedback(db,{aspect:'Setting',sentiment:'Mixed'});await publish(db,(await candidates(db))[0]);
  const id=await addFeedback(db,{text:'The setting still feels remote and its changing weather is interesting.',aspect:'Setting',sentiment:'Mixed'});
  assert.deepEqual(await candidates(db),[]);assert.equal((await db.query('select count(*) n from private.librarian_feed_evidence where feedback_id=$1',[id])).rows[0].n,0);
  await db.exec("update activity_events set occurred_at=now()-interval '1 day' where event_type='librarian';");
  assert((await candidates(db))[0].eligible_reasons.includes('reading_reaction'));
});

test('changing opinions require opposing evidence on the same aspect and reading lifecycle',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());await addFeedback(db,{});const c=(await candidates(db))[0];
  assert(c.eligible_reasons.includes('changing_opinion'));assert.equal(c.change_evidence[0].previous_feedback.sentiment,'Negative');
  await assert.rejects(publish(db,c,{reason:'changing_opinion'}),/opposing comparison/);
  const r=await publish(db,c,{reason:'changing_opinion',comparison:[c.change_evidence[0].previous_feedback.id]});assert.equal(r.status,'published');
  await addFeedback(db,{text:'The characters are frustrating even though the location remains engaging.',sentiment:'Negative',aspect:'Characters'});
  assert.deepEqual(await candidates(db),[]);
});

test('completion needs final qualitative evidence; progress alone never creates an editorial candidate',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());await db.exec("update reading_sessions set current_page=200,status='Completed',completed_at=now();update library_entries set overall_status='Read';");
  assert.deepEqual(await candidates(db),[]);await addFeedback(db,{stage:'Post-read',aspect:'Overall Review',sentiment:'Mixed',text:'The expedition was absorbing but the ending left the central mystery unresolved.'});
  const c=(await candidates(db))[0];assert(c.eligible_reasons.includes('completed_review'));
  const r=await publish(db,c,{reason:'completed_review',text:'Calum found the expedition absorbing, but the unresolved central mystery weakened the ending.',key:'review:expedition-engages:unresolved-ending'});
  assert.equal(r.status,'published');assert((await db.query('select hashtags from activity_events where id=$1',[r.event_id])).rows[0].hashtags.includes('review'));
});

test('new strong aspects can justify one exception; hard daily cap and exception caps prevent an hourly stream',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());await addFeedback(db,{sentiment:'Mixed',aspect:'Setting'});await publish(db,(await candidates(db))[0]);
  await addFeedback(db,{text:'The humour is unexpectedly effective and the understated exchanges are making the unfamiliar expedition feel more immediate, without undermining its tension.',aspect:'Humour',strength:'Strong'});
  const c=(await candidates(db))[0];assert.deepEqual(c.eligible_reasons,['significant_feedback']);await publish(db,c,{reason:'significant_feedback',key:'humour:understated:expedition-immediacy',text:'Calum finds the understated humour unexpectedly effective, bringing the expedition closer without diluting its tension.'});
  await addFeedback(db,{text:'The relationships are unexpected and their competing loyalties are becoming a much more interesting part of this expedition than the initial setup suggested.',aspect:'Relationships',strength:'Strong'});
  assert.deepEqual(await candidates(db),[]);
  await db.exec("insert into activity_events(user_id,book_id,event_type,source,idempotency_key,content,hashtags) values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','librarian','user','cap-fixture','Existing manual fixture note.',array['librarian']);");
  assert.deepEqual(await candidates(db),[]);
});

test('meaningful edits are new revisions; enrichment/repeated saves and copied feedback are not',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());await addFeedback(db,{});const c=(await candidates(db))[0];await publish(db,c);
  await db.exec("update reading_feedback set confidence='Medium',updated_at=now();");assert.deepEqual(await candidates(db),[]);
  await addFeedback(db,{text:c.new_feedback[0].user_feedback.toUpperCase()});assert.deepEqual(await candidates(db),[]);
  await db.exec("update activity_events set occurred_at=now()-interval '1 day' where event_type='librarian';");
  await db.query("update reading_feedback set user_feedback=$1,sentiment='Negative',confidence='High',updated_at=clock_timestamp() where id=$2",['The pace is now frustrating and the exploration no longer holds my attention.',c.new_feedback[0].id]);
  const edit=(await candidates(db))[0];assert(edit.eligible_reasons.includes('changing_opinion'));assert.equal(edit.change_evidence[0].previous_feedback.sentiment,'Positive');
});

test('stale, unrelated and invalid candidates are rejected without consuming valid updates',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());await addFeedback(db,{});const c=(await candidates(db))[0];
  const unrelated=await addFeedback(db,{book:bookId(2),session:null,aspect:'Setting'});
  await assert.rejects(publish(db,c,{ids:[unrelated]}),/does not belong/);
  await assert.rejects(publish(db,c,{comparison:[unrelated]}),/Unrelated comparison/);
  await assert.rejects(publish(db,{...c,candidate_id:'not-a-candidate'}),/Invalid candidate/);
  await assert.rejects(publish(db,c,{ids:[]}),/distinct feedback/);
  await assert.rejects(publish(db,c,{text:'x'.repeat(1201)}),/1200/);
  await addFeedback(db,{text:'The puzzle is now revealing its mechanisms, which I find unusually satisfying.',aspect:'Mystery'});
  await assert.rejects(publish(db,c),/stale/);assert.equal((await db.query('select count(*) n from private.librarian_feed_receipts')).rows[0].n,0);
  const fresh=(await candidates(db)).find(c=>c.book_id===bookId(1));assert.equal(fresh.new_feedback.length,2);assert.equal((await publish(db,fresh)).status,'published');
});

test('stable observation keys and normalised prose reject duplicated observations without losing unprocessed feedback',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());await addFeedback(db,{});const c=(await candidates(db))[0];const first=await publish(db,c);
  await db.exec("update activity_events set occurred_at=now()-interval '1 day' where event_type='librarian';");
  await addFeedback(db,{aspect:'Setting',text:'The gradual discovery is still sustaining curiosity about the unfamiliar setting.'});const next=(await candidates(db))[0];
  assert.equal((await publish(db,next,{text:'Calum remains curious as the exploration continues to gather momentum.'})).status,'duplicate_observation');
  assert.equal((await publish(db,next,{text:'CALUM IS MORE ENGAGED NOW THAT THE EXPLORATION HAS GAINED MOMENTUM!',key:'different:key:exact-prose-duplicate'})).event_id,first.event_id);
  assert.equal((await candidates(db))[0].candidate_id,next.candidate_id);
  assert.equal((await db.query("select count(*) n from activity_events where event_type='librarian'")).rows[0].n,1);
});

test('only management SQL can discover/publish/read audit; foreign feedback, books and sessions are excluded',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());await addFeedback(db,{user:other});assert.deepEqual(await candidates(db),[]);
  await db.exec(`insert into books(id,title) values('${bookId(3)}','Outside library');`);await addFeedback(db,{book:bookId(3),session:null});assert.deepEqual(await candidates(db),[]);
  await addFeedback(db,{book:bookId(2)});assert.deepEqual(await candidates(db),[]);
  await addFeedback(db,{});const c=(await candidates(db))[0];
  for(const role of ['anon','authenticated','service_role']){await db.exec(`set role ${role}`);
    await assert.rejects(candidates(db),/permission denied/);await assert.rejects(publish(db,c),/permission denied/);
    await assert.rejects(db.query('select * from private.librarian_feed_evidence'),/permission denied/);await db.exec('reset role');
  }
  await db.exec('grant execute on function public.librarian_feed_candidates(integer),public.publish_librarian_feed_reflection(text,text,uuid[],text,text,uuid[]) to authenticated;set role authenticated;');
  await assert.rejects(candidates(db),/Management SQL/);await assert.rejects(publish(db,c),/Management SQL/);await db.exec('reset role');
  assert.equal((await publish(db,c)).status,'published');await db.exec('set role authenticated');
  assert.equal((await db.query("select count(*) n from activity_events where event_type='librarian'")).rows[0].n,1);
  await db.exec(`reset role;select set_config('request.jwt.claim.sub','${other}',false);set role authenticated;`);
  assert.equal((await db.query("select count(*) n from activity_events where event_type='librarian'")).rows[0].n,0);
});

test('taste/milestone reflections need fresh qualitative feedback and retain recorded confidence/relation',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());const id=await addFeedback(db,{aspect:'Exploration'});
  const taste=(await db.query("insert into taste_profile(user_id,dimension,preference,direction,confidence,evidence_count) values($1,'Exploration','Gradual discovery holds attention.','Positive','Medium',2) returning id",[owner])).rows[0].id;
  await db.query('update reading_feedback set generalisable=true where id=$1',[id]);
  await db.query("insert into taste_evidence(taste_profile_id,feedback_id,relation) values($1,$2,'context')",[taste,id]);
  const c=(await candidates(db))[0];assert(c.eligible_reasons.includes('taste_discovery'));assert(c.eligible_reasons.includes('reading_milestone'));
  assert.equal(c.taste_context[0].confidence,'Medium');assert.equal(c.taste_context[0].relation,'context');assert.equal(c.automatic_taste_events.length,1);
  await publish(db,c,{reason:'taste_discovery',key:'exploration:gradual-discovery:sustained-curiosity'});
  assert.deepEqual(await candidates(db),[]);
  await db.exec("update taste_profile set preference='Gradual discovery can hold attention with a clear direction.';update reading_sessions set current_page=120;");
  assert.deepEqual(await candidates(db),[]);
});

test('rollback after publishing leaves candidate eligible and retry creates exactly one committed entry',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());await addFeedback(db,{});const c=(await candidates(db))[0];
  await db.exec('begin');assert.equal((await publish(db,c)).status,'published');await db.exec('rollback');
  assert.equal((await candidates(db))[0].candidate_id,c.candidate_id);assert.equal((await publish(db,c)).status,'published');
  assert.equal((await publish(db,c)).status,'already_published');
  assert.equal((await db.query("select count(*) n from activity_events where event_type='librarian'")).rows[0].n,1);
});

test('duplicated fresh feedback is batched once; rereads do not manufacture a same-session opinion change',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());await addFeedback(db,{});await addFeedback(db,{});const c=(await candidates(db))[0];
  assert.equal(c.new_feedback.length,1);await publish(db,c);
  await db.exec("update reading_sessions set status='Completed';update activity_events set occurred_at=now()-interval '1 day' where event_type='librarian';");
  const second=(await db.query("insert into reading_sessions(user_id,book_id,status,session_type) values($1,$2,'Reading','Reread') returning id",[owner,bookId(1)])).rows[0].id;
  await addFeedback(db,{session:second,sentiment:'Negative',text:'On this reread the pace feels frustrating and the exploration is less engaging.'});
  const reread=(await candidates(db))[0];assert.equal(reread.session_id,second);assert(!reread.eligible_reasons.includes('changing_opinion'));
});

test('the exact live acceptance script passes with all source and feed fixtures rolled back',async t=>{
  const db=await reflectionsDb();t.after(()=>db.close());
  const before=(await db.query('select count(*) n from activity_events')).rows[0].n;
  await db.exec(await readFile('tests/sql/librarian-feed-live.sql','utf8'));
  assert.equal((await db.query('select count(*) n from activity_events')).rows[0].n,before);
  assert.equal((await db.query('select owner_user_id from private.app_state')).rows[0].owner_user_id,owner);
});
