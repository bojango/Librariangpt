import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { enrichmentDb, hardeningMigration } from '../helpers/enrichment-db.js';

test('Library enrichment hardening executes real PostgreSQL migrations and RPCs', async t => {
  const db = await enrichmentDb();
  t.after(() => db.close());
  const scenario = (name, run) => t.test(name, async () => {
    await db.exec('begin');
    try { await run(); } finally { await db.exec('rollback'); }
  });
  const add = async (title, member = true, status = 'unresolved') => {
    const id = (await db.query('insert into books(title,metadata_status) values($1,$2) returning id',[title,status])).rows[0].id;
    if (member) await db.query('insert into library_entries(book_id) values($1)',[id]);
    return id;
  };
  const job = async id => (await db.query('select * from book_enrichment_jobs where book_id=$1',[id])).rows[0];
  const health = async id => (await db.query('select * from v_library_enrichment_health where book_id=$1',[id])).rows[0];
  const complete = async id => {
    const edition = (await db.query(`insert into editions(book_id,isbn13,page_count,publisher,format,publication_year,cover_url)
      values($1,'9781101904220',342,'Crown','Paperback',2016,'https://covers.example/test.jpg') returning id`,[id])).rows[0].id;
    await db.query("update books set reference_edition_id=$2,synopsis='A reliable synopsis',metadata_status='resolved' where id=$1",[id,edition]);
    return edition;
  };
  const rating = async (id, age = '8 days') => db.query(`insert into public_ratings(book_id,provider,provider_book_id,source_url,rating_5,rating_count,fetched_at)
    values($1,'Goodreads','123','https://www.goodreads.com/book/show/123',4.2,100,now()-$2::interval)`,[id,age]);

  await scenario('direct DB books and existing books added later use the authoritative Library insert', async () => {
    const id = await add('Direct DB',false);
    assert.equal(await job(id),undefined);
    await db.query("insert into library_entries(book_id,source) values($1,'chatgpt')",[id]);
    assert.equal((await job(id)).status,'queued');
    assert.equal((await db.query('select * from rating_refresh_state where book_id=$1',[id])).rows.length,1);
    assert.equal((await db.query('select * from claim_book_enrichment_jobs(2,null,false)')).rows[0].book_id,id);
    assert.equal((await db.query('select * from claim_book_enrichment_jobs(2,null,false)')).rows.length,0);
    const frontend = await add('Frontend');
    assert.equal((await job(frontend)).status,'queued');
  });
  await scenario('metadata resolved plus Goodreads failed remains independently retryable', async () => {
    const id = await add('Resolved');
    await complete(id);
    await db.query("update rating_refresh_state set failure_count=2,last_error='HTTP 202',next_retry_at=now()-interval '1 hour' where book_id=$1",[id]);
    assert.equal((await job(id)).status,'completed');
    const state = await health(id);
    assert.equal(state.metadata_complete,true);
    assert.equal(state.goodreads_complete,false);
    assert.equal(state.goodreads_retry_due,true);
    assert.equal(state.fully_enriched,false);
    assert.equal((await db.query('select * from select_due_goodreads_rating_books()')).rows[0].book_id,id);
    assert.equal((await db.query('select claim_goodreads_rating_refresh($1,false) as claimed',[id])).rows[0].claimed,true);
    assert.equal((await db.query('select claim_goodreads_rating_refresh($1,false) as claimed',[id])).rows[0].claimed,false);
  });
  await scenario('scheduler excludes non-Library books and prioritises missing then failed then stale', async () => {
    const outsider = await add('Not Library',false); await rating(outsider);
    const stale = await add('Stale'); await rating(stale);
    const failed = await add('Failed'); await rating(failed);
    await db.query("update rating_refresh_state set failure_count=2,next_retry_at=now()-interval '1 hour' where book_id=$1",[failed]);
    const missing = await add('Missing');
    const fresh = await add('Fresh'); await rating(fresh,'1 day');
    const delayed = await add('Delayed');
    await db.query("update rating_refresh_state set next_retry_at=now()+interval '6 hours' where book_id=$1",[delayed]);
    assert.deepEqual((await db.query('select * from select_due_goodreads_rating_books()')).rows.map(x=>x.book_id),[missing,failed,stale]);
    assert.equal((await db.query('select claim_goodreads_rating_refresh($1,true) as claimed',[outsider])).rows[0].claimed,false);
  });
  await scenario('legacy failed partial books become deferred and become due again', async () => {
    const id = await add('Legacy partial');
    await db.query("update book_enrichment_jobs set status='failed',attempt_count=5,last_attempted_at=now() where book_id=$1",[id]);
    await db.exec('select reconcile_library_enrichment()');
    assert.equal((await job(id)).status,'deferred');
    assert.ok((await job(id)).available_at > new Date());
    assert.equal((await db.query('select * from claim_book_enrichment_jobs()')).rows.length,0);
    await db.query("update book_enrichment_jobs set available_at=now()-interval '1 second' where book_id=$1",[id]);
    assert.equal((await db.query('select * from claim_book_enrichment_jobs()')).rows[0].attempt_count,6);
  });
  await scenario('reconciliation requeues resolved but incomplete books without resetting backoff or active work', async () => {
    const incomplete = await add('No data but resolved',true,'resolved');
    await db.query("update book_enrichment_jobs set status='completed' where book_id=$1",[incomplete]);
    const retry = await add('Retry');
    await db.query("update book_enrichment_jobs set status='deferred',attempt_count=9,available_at=now()+interval '7 days' where book_id=$1",[retry]);
    const active = await add('Active');
    await db.query("update book_enrichment_jobs set status='processing',locked_at=now() where book_id=$1",[active]);
    const beforeRetry = await job(retry), beforeActive = await job(active);
    await db.exec('select reconcile_library_enrichment()');
    assert.equal((await job(incomplete)).status,'queued');
    assert.deepEqual(await job(retry),beforeRetry);
    assert.deepEqual(await job(active),beforeActive);
    const before = (await db.query('select * from book_enrichment_jobs order by book_id')).rows;
    const result = (await db.query('select reconcile_library_enrichment() as result')).rows[0].result;
    assert.equal(result.metadata_enqueued,0);
    assert.deepEqual((await db.query('select * from book_enrichment_jobs order by book_id')).rows,before);
    await db.exec(await readFile(hardeningMigration,'utf8'));
    assert.equal((await db.query("select * from cron.job where jobname='library-enrichment-reconciliation-twice-daily'")).rows.length,1);
  });
  await scenario('reconciliation and provider patches preserve user covers and locked/verified identity', async () => {
    const id = await add('Manual',true,'manual');
    const edition = await complete(id);
    await db.query("update editions set identity_locked=true,exact_copy_verified=true,cover_locked=true,cover_uploaded_by_user=true,page_count_verified=true where id=$1",[edition]);
    await db.query("update books set metadata_status='manual',cover_locked=true,cover_url_preferred='https://uploads.example/user.jpg',synopsis='Manual synopsis' where id=$1",[id]);
    const beforeBook = (await db.query('select * from books where id=$1',[id])).rows[0];
    const beforeEdition = (await db.query('select * from editions where id=$1',[edition])).rows[0];
    await db.exec('select reconcile_library_enrichment()');
    assert.deepEqual((await db.query('select * from books where id=$1',[id])).rows[0],beforeBook);
    assert.deepEqual((await db.query('select * from editions where id=$1',[edition])).rows[0],beforeEdition);
    await db.query("update editions set isbn13='9780306406157',publisher='Wrong',page_count=999 where id=$1",[edition]);
    const after = (await db.query('select * from editions where id=$1',[edition])).rows[0];
    assert.equal(after.isbn13,beforeEdition.isbn13); assert.equal(after.publisher,beforeEdition.publisher); assert.equal(after.page_count,beforeEdition.page_count);
  });
  await scenario('provider backoff is monotonic and service-only health/state access works', async () => {
    await add('Service book');
    await db.exec("set role service_role; select extend_enrichment_provider_backoff('google_books',now()+interval '1 hour','{}'); select extend_enrichment_provider_backoff('google_books',now()+interval '1 minute','{}');");
    assert.equal((await db.query('select retry_after > now()+interval \'59 minutes\' as held from enrichment_provider_state')).rows[0].held,true);
    assert.equal((await db.query('select * from v_library_enrichment_health')).rows.length,1);
    await db.exec('select reconcile_library_enrichment(); reset role;');
    assert.equal((await db.query("select has_table_privilege('authenticated','v_library_enrichment_health','select') as allowed")).rows[0].allowed,false);
    assert.equal((await db.query("select has_function_privilege('anon','public.reconcile_library_enrichment()','execute') as allowed")).rows[0].allowed,false);
  });
});
