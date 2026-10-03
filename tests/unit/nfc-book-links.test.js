import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { plannerDb, seed, owner, other, bookId, rpc } from '../helpers/planner-db.js';
import { handleOpenBookRequest } from '../../supabase/functions/nfc-open-book/core.js';
import { tokenHash } from '../../supabase/functions/nfc-reading-session/core.js';
import { copyNfcBookId } from '../../src/features/nfc-book-link.js';

const migration = 'supabase/migrations/20261003162345_nfc_book_links.sql';
const bookmark = '40000000-0000-0000-0000-000000000001';
const token = `${bookmark}.${'ab'.repeat(32)}`;

test('book sticker HTTP contract rejects invalid capabilities and payloads without leaking secrets', async () => {
  const hash = await tokenHash(token);
  let enabled = true, result = { status: 'queued', book_id: bookId(1), book_title: 'Gateway', token_hash: hash }, calls = [];
  const deps = { lookupBookmark: async () => ({ enabled, token_hash: hash }), queueBook: async (...args) => { calls.push(args); return result; } };
  const post = (value = token, body = { book_id: bookId(1) }, method = 'POST') => handleOpenBookRequest(new Request('https://example.test', {
    method, headers: { 'X-NFC-Bookmark-Token': value }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
  }), deps);
  const valid = await post(); assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { status: 'queued', book_id: bookId(1), book_title: 'Gateway' });
  assert.deepEqual(calls[0], [bookmark, hash, bookId(1)]);
  for (const value of ['', 'malformed', `${bookmark}.${'ff'.repeat(32)}`, `${token}.extra`]) assert.equal((await post(value)).status, 401);
  enabled = false; assert.equal((await post()).status, 401); enabled = true;
  for (const body of [null, {}, { book_id: 123 }, { book_id: 'bad-uuid' }]) assert.equal((await post(token, body)).status, 400);
  const invalidJson = await handleOpenBookRequest(new Request('https://example.test', { method: 'POST', headers: { 'X-NFC-Bookmark-Token': token }, body: '{' }), deps);
  assert.equal(invalidJson.status, 400);
  assert.equal(calls.length, 1);
  result = { status: 'book_not_found' }; const missing = await post(); assert.equal(missing.status, 404); assert.deepEqual(await missing.json(), result);
  result = { status: 'unauthorized' }; assert.equal((await post()).status, 401);
  assert.equal((await post(token, {}, 'GET')).status, 405);
  deps.lookupBookmark = async () => { throw new Error('secret backend detail'); };
  const failure = await post(); assert.equal(failure.status, 503); assert.deepEqual(await failure.json(), { status: 'temporarily_unavailable' });
});

test('actual PostgreSQL book queue, consumption, priority and role boundaries', async t => {
  const db = await plannerDb(); t.after(() => db.close());
  for (const file of ['20261001190514_nfc_reading_sessions.sql','20261003055328_active_nfc_reading_sessions.sql','20261003125936_nfc_session_kind.sql','20261003162345_nfc_book_links.sql']) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await seed(db);
  await db.exec('grant select,update on public.library_entries,public.reading_sessions,public.books to service_role; grant select on public.progress_logs,public.library_events to service_role');
  const hash = await tokenHash(token);
  await db.query('insert into public.nfc_bookmarks(id,user_id,name,token_hash,token_hint) values($1,$2,$3,$4,$5)', [bookmark,owner,'Synthetic',hash,'hint']);
  await db.query("insert into public.books(id,title) values($1,'Other user only')", [bookId(98)]);
  await db.query("insert into public.library_entries(user_id,book_id,overall_status) values($1,$2,'Read')", [other,bookId(98)]);
  const queue = async (id = bookId(1), h = hash) => { await db.exec('set local role service_role'); try { return await rpc(db,'queue_nfc_book',[bookmark,h,id]); } finally { await db.exec('reset role'); } };
  const consume = async (include = true) => { await db.exec('set local role authenticated'); try { return await rpc(db,'nfc_app_destination',[include]); } finally { await db.exec('reset role'); } };
  const rows = async table => (await db.query(`select * from public.${table} order by 1`)).rows;
  const scenario = (name, run) => t.test(name, async () => { await db.exec('begin'); try { await run(); } finally { await db.exec('rollback'); } });
  await scenario('all library statuses accepted; exact safe metadata; only navigation mutates', async () => {
    const tables = ['library_entries','books','reading_sessions','reading_time_sessions','progress_logs','library_events','recommendations','nfc_bookmarks','nfc_pending_starts'];
    for (const status of ['Read','Currently Reading','Owned - Unread','Wishlist','Recommended','Paused','DNF','Not Interested']) {
      await db.query('update public.library_entries set overall_status=$1 where book_id=$2',[status,bookId(1)]);
      const before = await Promise.all(tables.map(rows));
      assert.deepEqual(await queue(), { status: 'queued', book_id: bookId(1), book_title: 'Long SF' });
      assert.deepEqual(await Promise.all(tables.map(rows)),before);
    }
  });
  await scenario('missing and other-user-only books identical; no request or metadata leak', async () => {
    for (const id of [bookId(98),bookId(97)]) assert.deepEqual(await queue(id), { status: 'book_not_found' });
    assert.equal((await rows('app_navigation_requests')).length,0);
    assert.deepEqual(await queue(bookId(1),'ff'.repeat(32)),{ status: 'unauthorized' });
    await db.exec('update public.nfc_bookmarks set enabled=false');
    assert.deepEqual(await queue(),{ status: 'unauthorized' });
  });
  await scenario('noncanonical bookmark owner rejected even with correct hash', async () => {
    await db.query('update public.nfc_bookmarks set user_id=$1',[other]);
    assert.deepEqual(await queue(bookId(98)),{ status: 'unauthorized' });
  });
  await scenario('latest tap supersedes, non-Home preserves, atomic retrieval clears, repeat is empty', async () => {
    await queue(); await queue(bookId(2));
    assert.equal((await rows('app_navigation_requests')).length,1);
    assert.equal(await consume(false),null);
    assert.deepEqual(await consume(),{ name: 'book', bookId: bookId(2) });
    assert.equal(await consume(),null);
    assert.equal((await rows('app_navigation_requests')).length,0);
  });
  await scenario('running and ended session beat book; resolving session leaves queued book', async () => {
    await queue();
    const s = await rpc(db,'tap_nfc_bookmark',[bookmark,hash]);
    assert.equal((await consume()).name,'reading-session-active');
    await rpc(db,'control_nfc_session',[s.session_id,'end',null]);
    assert.equal((await consume()).name,'reading-session-finish');
    assert.equal((await rows('app_navigation_requests')).length,1);
    await rpc(db,'finish_nfc_reading_session',[s.session_id,null,true]);
    assert.deepEqual(await consume(),{ name: 'book',bookId: bookId(1) });
  });
  await scenario('pending session selection wins until cancelled', async () => {
    await queue(); await db.exec("update public.reading_sessions set status='Paused'");
    const q = await rpc(db,'tap_nfc_bookmark',[bookmark,hash]);
    assert.equal((await consume()).name,'reading-session-choose');
    assert.equal((await rows('app_navigation_requests')).length,1);
    await rpc(db,'control_nfc_session',[q.request_id,'cancel',null]);
    assert.equal((await consume()).bookId,bookId(1));
  });
  await scenario('library removal clears stale destination without opening it', async () => {
    await queue(); await db.query('delete from public.library_entries where book_id=$1',[bookId(1)]);
    assert.equal(await consume(),null); assert.equal((await rows('app_navigation_requests')).length,0);
  });
  await scenario('anon, other authenticated user, browser spoofing and token-hash restrictions', async () => {
    await queue();
    await db.exec('set local role anon');
    await assert.rejects(rpc(db,'nfc_app_destination',[true]),/permission denied/);
    await assert.rejects(rpc(db,'queue_nfc_book',[bookmark,hash,bookId(2)]),/permission denied/);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[other]);
    await db.exec('set local role authenticated');
    assert.equal((await rows('app_navigation_requests')).length,0);
    await assert.rejects(rpc(db,'nfc_app_destination',[true]),/Not authorized/);
    await assert.rejects(rpc(db,'queue_nfc_book',[bookmark,hash,bookId(2)]),/permission denied/);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,true)",[owner]);
    await db.exec('set local role authenticated');
    assert.equal((await rows('app_navigation_requests')).length,1);
    for (const privilege of ['INSERT','UPDATE','DELETE']) assert.equal((await db.query("select has_table_privilege('authenticated','public.app_navigation_requests',$1) ok",[privilege])).rows[0].ok,false);
    assert.equal((await db.query("select has_table_privilege('anon','public.app_navigation_requests','SELECT') ok")).rows[0].ok,false);
    assert.equal((await db.query("select has_column_privilege('authenticated','public.nfc_bookmarks','token_hash','SELECT') ok")).rows[0].ok,false);
    await db.exec('reset role');
    assert.equal((await consume()).bookId,bookId(1));
  });
});

test('copy action writes canonical UUID and provides success/failure feedback', async () => {
  let copied, feedback;
  await copyNfcBookId(bookId(1),{ clipboard: { writeText: async value => { copied=value; } },notify: (...args) => { feedback=args; } });
  assert.equal(copied,bookId(1)); assert.deepEqual(feedback,['NFC book ID copied.']);
  await copyNfcBookId(bookId(1),{ clipboard: { writeText: async () => { throw new Error('Denied'); } },notify: (...args) => { feedback=args; } });
  assert.equal(feedback[1],true);
});

test('rollback-backed live SQL acceptance harness also passes against actual fixture schema', async t => {
  const db = await plannerDb(); t.after(() => db.close());
  for (const file of ['20261001190514_nfc_reading_sessions.sql','20261003055328_active_nfc_reading_sessions.sql','20261003125936_nfc_session_kind.sql','20261003162345_nfc_book_links.sql']) await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
  await seed(db);
  await db.exec('grant select,update on public.library_entries,public.reading_sessions,public.books to service_role');
  await db.exec(await readFile('tests/sql/nfc-book-links-live.sql','utf8'));
  assert.equal((await db.query('select owner_user_id from private.app_state')).rows[0].owner_user_id,owner);
  assert.equal((await db.query('select count(*)::int n from public.nfc_bookmarks')).rows[0].n,0);
});

test('frontend contains only authenticated destination consumption; service key stays in Edge entrypoint', async () => {
  const [app,data,view,built,edge] = await Promise.all(['src/app.js','src/data/nfc.js','src/views/book-detail.js','dist/app.js','supabase/functions/nfc-open-book/index.ts'].map(p => readFile(p,'utf8')));
  assert.match(app,/loadNfcDestination\(parseRoute\(\)\.name === 'home'\)/);
  assert.match(data,/nfc_app_destination/); assert.match(view,/data-copy-nfc-book-id/);
  assert.doesNotMatch(`${app}${data}${built}`,/SUPABASE_SERVICE_ROLE_KEY|queue_nfc_book/);
  assert.match(edge,/SUPABASE_SERVICE_ROLE_KEY/);
});
