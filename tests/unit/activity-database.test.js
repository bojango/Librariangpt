import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { plannerDb, owner, other, bookId } from '../helpers/planner-db.js';

export const activityMigration = 'supabase/migrations/20261010110322_private_profile_activity.sql';
async function setup() {
  const db = await plannerDb();
  await db.exec(await readFile('supabase/migrations/20260909181552_book_quotes_and_passages.sql', 'utf8'));
  await db.exec(await readFile(activityMigration, 'utf8'));
  await db.exec(await readFile('supabase/migrations/20261010110712_automation_librarian_entries.sql','utf8'));
  await db.query(`insert into public.books(id,title,primary_genre) values($1,'Activity test','Science Fiction')`, [bookId(1)]);
  return db;
}
async function events(db, kind = null) {
  return (await db.query('select * from public.activity_events where ($1::text is null or event_type=$1) order by created_at,id', [kind])).rows;
}

test('source-table capture ignores metadata and repeat saves, coalesces session/library events and ratings', async () => {
  const db = await setup();
  try {
    await db.query(`insert into public.library_entries(user_id,book_id,overall_status,ownership_status,total_pages) values($1,$2,'Wishlist','Not Owned',200)`, [owner,bookId(1)]);
    assert.equal((await events(db,'wishlist')).length,1);
    await db.query(`update public.library_entries set notes='Metadata',updated_at=now() where book_id=$1`,[bookId(1)]);
    await db.query(`update public.library_entries set overall_status='Wishlist' where book_id=$1`,[bookId(1)]);
    assert.equal((await events(db)).length,1);
    await db.query(`update public.library_entries set ownership_status='Owned',overall_status='Owned - Unread' where book_id=$1`,[bookId(1)]);
    assert.equal((await events(db,'bought')).length,1);
    await db.exec(`begin; insert into public.reading_sessions(user_id,book_id,status,started_at,total_pages,current_page)
      values('${owner}','${bookId(1)}','Reading',now(),200,0);
      update public.library_entries set overall_status='Currently Reading',started_at=now() where book_id='${bookId(1)}'; commit;`);
    assert.equal((await events(db,'started')).length,1);
    await db.exec(`begin; update public.reading_sessions set status='Completed',completed_at=now(),user_rating_5=3.8;
      update public.library_entries set overall_status='Read',completed_at=now(),user_rating_5=3.8; commit;`);
    assert.equal((await events(db,'finished')).length,1);
    assert.equal((await events(db,'rating')).length,0);
    assert.equal((await events(db,'finished'))[0].metadata.rating,3.8);
    await db.exec(`begin; update public.reading_sessions set user_rating_5=4;
      update public.library_entries set user_rating_5=4; commit;`);
    assert.equal((await events(db,'rating')).length,1);
    assert.equal((await events(db,'finished'))[0].metadata.rating,4);
  } finally { await db.close(); }
});

test('milestones are not emitted for every page or page-total corrections and are idempotent on rewinds', async () => {
  const db = await setup();
  try {
    await db.exec(`insert into public.library_entries(user_id,book_id,overall_status) values('${owner}','${bookId(1)}','Currently Reading');
      insert into public.reading_sessions(user_id,book_id,status,started_at,total_pages,current_page) values('${owner}','${bookId(1)}','Reading',now(),200,0);`);
    for (const page of [1,2,49,50,51,40,50,100,150]) await db.query('update public.reading_sessions set current_page=$1',[page]);
    assert.deepEqual((await events(db,'progress')).map(e => e.metadata.percent).sort(),[25,50,75]);
    await db.exec('update public.reading_sessions set total_pages=160');
    assert.equal((await events(db,'progress')).length,3);
    await db.exec(`update public.reading_sessions set status='Paused'`);
    await db.exec(`update public.reading_sessions set status='DNF'`);
    assert.equal((await events(db,'paused')).length,1);
    assert.equal((await events(db,'dnf')).length,1);
  } finally { await db.close(); }
});

test('quote text stays exact, editing updates one post and deleting removes it', async () => {
  const db = await setup();
  try {
    const exact = '  First line.\n\n“Second line.” <script>test</script>  ';
    await db.query('insert into public.book_quotes(user_id,book_id,quote_text,page_start,page_end,chapter,note) values($1,$2,$3,12,14,$4,$5)',[owner,bookId(1),exact,'Three','Personal note']);
    const before = (await events(db,'quotes'))[0];
    assert.equal(before.metadata.quote_text,exact);
    await db.query('update public.book_quotes set quote_text=$1,note=$2',[exact+'\nEdit','New note']);
    const after = await events(db,'quotes');
    assert.equal(after.length,1); assert.equal(after[0].id,before.id); assert.equal(after[0].occurred_at.getTime(),before.occurred_at.getTime());
    assert.equal(after[0].metadata.note,'New note');
    await db.exec('update public.book_quotes set note=null,chapter=null,page_start=null,page_end=null');
    const cleared=(await events(db,'quotes'))[0]; assert.equal(cleared.metadata.note,null); assert.equal(cleared.metadata.page_start,null);
    await db.exec('delete from public.book_quotes');
    assert.equal((await events(db,'quotes')).length,0);
  } finally { await db.close(); }
});

test('session identity retains two rereads in one transaction and reverse source order coalesces', async () => {
  const db=await setup();
  try {
    await db.exec(`begin;
      insert into public.library_entries(user_id,book_id,overall_status,started_at) values('${owner}','${bookId(1)}','Currently Reading',now());
      insert into public.reading_sessions(user_id,book_id,status,started_at) values('${owner}','${bookId(1)}','Reading',now()); commit;`);
    assert.equal((await events(db,'started')).length,1);
    await db.exec(`begin; insert into public.reading_sessions(user_id,book_id,status,completed_at) values
      ('${owner}','${bookId(1)}','Completed','2026-04-01'),('${owner}','${bookId(1)}','Completed','2026-05-01'); commit;`);
    assert.equal((await events(db,'finished')).length,2);
    await db.exec(`update public.reading_sessions set status='Paused' where status='Reading';`);
    await db.exec(`update public.reading_sessions set status='Reading' where status='Paused';`);
    assert.equal((await events(db,'started')).length,1);
  } finally { await db.close(); }
});

test('taste posts require meaningful canonical changes and keep low-confidence evidence tentative', async () => {
  const db=await setup();
  try {
    await db.query(`insert into public.taste_profile(user_id,dimension,preference,direction,strength,confidence,evidence_count) values($1,'Discovery','Enjoys discovery','Positive','Strong','Low',1)`,[owner]);
    assert.equal((await events(db,'taste')).length,0);
    await db.exec(`update public.taste_profile set confidence='High',evidence_count=3`);
    assert.equal((await events(db,'taste')).length,1);
    await db.exec(`update public.taste_profile set last_updated=current_date,evidence_count=4`);
    assert.equal((await events(db,'taste')).length,1);
    await db.exec(`update public.taste_profile set preference='Enjoys grounded discovery'`);
    assert.equal((await events(db,'taste')).length,2);
  } finally { await db.close(); }
});

test('Librarian API is private, rejects foreign books and has stable idempotency', async () => {
  const db = await setup();
  try {
    await db.query(`insert into public.library_entries(user_id,book_id) values($1,$2)`,[owner,bookId(1)]);
    await db.exec('set role authenticated');
    const call = async () => (await db.query(`select public.add_librarian_entry('automation','A real reflection','test-key',$1,array['progress']) id`,[bookId(1)])).rows[0].id;
    assert.equal(await call(),await call());
    assert.equal((await events(db,'librarian')).length,1);
    await assert.rejects(db.query(`select public.add_librarian_entry('automation','bad','foreign',$1)`,[bookId(2)]));
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${other}',false); set role authenticated;`);
    assert.equal((await events(db)).length,0);
    await assert.rejects(call(),/Not authorized/);
    await db.exec('reset role; set role anon;');
    await assert.rejects(db.query('select * from public.activity_events'),/permission denied/);
    await assert.rejects(call(),/permission denied/);
  } finally { await db.close(); }
});

test('service-only automation API scopes to configured owner and denies browser roles', async () => {
  const db=await setup();
  try {
    await db.query('insert into public.library_entries(user_id,book_id) values($1,$2)',[owner,bookId(1)]);
    await db.exec('set role service_role');
    const call=async()=> (await db.query(`select public.add_automation_librarian_entry('automation','Server reflection','stable-server',$1,array['progress']) id`,[bookId(1)])).rows[0].id;
    assert.equal(await call(),await call());
    assert.equal((await events(db,'librarian'))[0].user_id,owner);
    await assert.rejects(db.query(`select public.add_automation_librarian_entry('automation','No foreign books','foreign',$1)`,[bookId(2)]),/not in the owner library/);
    await db.exec('reset role; set role authenticated'); await assert.rejects(call(),/permission denied/);
    await db.exec('reset role; set role anon'); await assert.rejects(call(),/permission denied/);
  } finally { await db.close(); }
});

test('backfill only uses substantiated records, retains rereads and can run repeatedly', async () => {
  const db = await setup();
  try {
    await db.exec(`insert into public.reading_sessions(user_id,book_id,status,started_at,completed_at) values
      ('${owner}','${bookId(1)}','Completed','2026-01-01','2026-01-04');`);
    await db.exec(`insert into public.reading_sessions(user_id,book_id,status,started_at,completed_at) values
      ('${owner}','${bookId(1)}','Completed','2026-03-01','2026-03-05');`);
    await db.exec('select private.backfill_activity();');
    const count = (await events(db)).length;
    await db.exec('select private.backfill_activity(); select private.backfill_activity();');
    assert.equal((await events(db)).length,count);
    assert.equal((await events(db,'finished')).length,2);
  } finally { await db.close(); }
});


