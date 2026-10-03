import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { plannerDb, seed, owner, other, bookId, rpc } from '../helpers/planner-db.js';
import { durationHms, durationSeconds, sessionStats, createNfcLifecycleCheck } from '../../src/features/reading-session.js';
import { parseRoute, routeHash } from '../../src/router.js';
import { handleNfcRequest, tokenHash } from '../../supabase/functions/nfc-reading-session/core.js';

const bookmark = '40000000-0000-0000-0000-000000000001';
const secondBookmark = '40000000-0000-0000-0000-000000000002';
export const extension = 'supabase/migrations/20261003055328_active_nfc_reading_sessions.sql';
export const classification = 'supabase/migrations/20261003125936_nfc_session_kind.sql';

test('active NFC PostgreSQL extension preserves canonical lifecycle and owner boundaries', async t => {
  const db = await plannerDb(); t.after(() => db.close());
  await db.exec(await readFile('supabase/migrations/20261001190514_nfc_reading_sessions.sql', 'utf8'));
  await db.exec(await readFile(extension, 'utf8'));
  await db.exec(await readFile(classification, 'utf8'));
  await seed(db);
  await db.exec('grant select,update on public.library_entries,public.reading_sessions to service_role; grant select on public.books,public.progress_logs,public.library_events to service_role');
  const hash = 'ab'.repeat(32);
  await db.query('insert into public.nfc_bookmarks(id,user_id,name,token_hash,token_hint) values($1,$2,$3,$4,$5),($6,$2,$3,$4,$5)', [bookmark, owner, 'Fixture', hash, 'hint', secondBookmark]);
  const call = (name, args = []) => rpc(db, name, args);
  const tap = (id = bookmark) => call('tap_nfc_bookmark', [id, hash]);
  const control = (id, action, book = null) => call('control_nfc_session', [id, action, book]);
  const rows = async table => (await db.query(`select * from public.${table}`)).rows;
  const age = async () => db.exec("update public.reading_time_sessions set started_at=clock_timestamp()-interval '42 minutes 18 seconds'; update public.nfc_bookmarks set last_tapped_at=clock_timestamp()-interval '30 seconds'");
  const start = async n => call('start_reading', [bookId(n), null, null]);
  const clearDefault = async () => db.exec('update public.nfc_bookmarks set active_book_id=null');
  const scenario = (name, run) => t.test(name, async () => {
    await db.exec('begin'); try { await run(); } finally { await db.exec('rollback'); }
  });
  await scenario('timed sessions default to reading and ended pending sessions can be marked test', async () => {
    const started = await tap();
    assert.equal((await rows('reading_time_sessions'))[0].session_kind, 'reading');
    await age(); await tap();
    const marked = await call('set_nfc_session_kind', [started.session_id, 'test']);
    assert.equal(marked.session_kind, 'test');
    assert.equal((await rows('reading_time_sessions'))[0].session_kind, 'test');
    await assert.rejects(call('set_nfc_session_kind', [started.session_id, 'invalid']), /Invalid session type/);
    await call('finish_nfc_reading_session', [started.session_id, null, true]);
    await assert.rejects(call('set_nfc_session_kind', [started.session_id, 'reading']), /Only an ended session awaiting page entry/);
  });
  await scenario('sole eligible book starts and persists shared active default', async () => {
    const s = await tap(); assert.equal(s.book_id, bookId(99)); assert.equal(s.status, 'started');
    assert.ok((await rows('nfc_bookmarks')).every(b => b.active_book_id === bookId(99)));
    assert.equal((await rows('reading_time_sessions'))[0].start_page, 273);
  });
  await scenario('pin beats active and all recent reading signals', async () => {
    await start(1); await db.query('update public.nfc_bookmarks set pinned_book_id=$1 where id=$2', [bookId(99), bookmark]);
    assert.equal((await tap()).book_id, bookId(99));
  });
  await scenario('active book beats most recent genuine activity', async () => {
    await start(1); await db.query('update public.nfc_bookmarks set active_book_id=$1', [bookId(99)]);
    assert.equal((await tap()).book_id, bookId(99));
  });
  await scenario('finished active and stale pin safely fall through', async () => {
    await db.query('update public.nfc_bookmarks set active_book_id=$1,pinned_book_id=$1', [bookId(1)]);
    await db.query("update public.library_entries set overall_status='Read' where book_id=$1", [bookId(1)]);
    assert.equal((await tap()).book_id, bookId(99));
  });
  await scenario('stale lifecycle cannot receive a timed session', async () => {
    await db.exec("update public.reading_sessions set status='Paused'");
    const q = await tap(); assert.equal(q.status, 'no_current_book'); assert.ok(q.request_id);
    assert.equal((await rows('reading_time_sessions')).length, 0);
  });
  await scenario('recent timed session is strongest fallback and must belong to eligible lifecycle', async () => {
    await start(1); await clearDefault();
    await db.query(`insert into public.reading_time_sessions(user_id,bookmark_id,book_id,reading_session_id,started_at,ended_at,start_page,progress_state,progress_submitted_at)
      values($1,$2,$3,$4,now()-interval '1 hour',now()-interval '30 minutes',273,'skipped',now())`, [owner, bookmark, bookId(99), (await db.query('select id from public.reading_sessions where book_id=$1', [bookId(99)])).rows[0].id]);
    assert.equal((await tap()).book_id, bookId(99));
  });
  await scenario('canonical progress activity outranks a later lifecycle start', async () => {
    await call('update_reading_progress', [bookId(99), 274, 'manual']); await start(1); await clearDefault();
    assert.equal((await tap()).book_id, bookId(99));
  });
  await scenario('most recently started/resumed lifecycle resolves multiple books', async () => {
    await start(1); await clearDefault(); assert.equal((await tap()).book_id, bookId(1));
  });
  await scenario('library updated_at and imported progress do not determine reading choice', async () => {
    await start(1); await clearDefault();
    await db.query("update public.library_entries set updated_at=now()+interval '1 day' where book_id=$1", [bookId(99)]);
    await db.query("insert into public.progress_logs(user_id,book_id,session_id,page,source) select user_id,book_id,id,274,'import' from public.reading_sessions where book_id=$1", [bookId(99)]);
    assert.equal((await tap()).book_id, bookId(1));
  });
  await scenario('multiple ambiguous lifecycles persist one request across duplicate scans', async () => {
    await start(1); await clearDefault();
    await db.exec("delete from public.library_events; update public.reading_sessions set started_at=null");
    const q = await tap(); assert.equal(q.status, 'needs_book_selection');
    assert.equal((await tap(secondBookmark)).request_id, q.request_id);
    assert.equal((await rows('nfc_pending_starts')).length, 1);
    assert.equal((await call('nfc_session_destination')).name, 'reading-session-choose');
    await control(q.request_id, 'cancel'); assert.equal(await call('nfc_session_destination'), null);
  });
  await scenario('no current book selection uses normal Start Reading and confirmation timestamp', async () => {
    await db.exec("update public.library_entries set overall_status='Paused' where overall_status='Currently Reading'; update public.reading_sessions set status='Paused'");
    const q = await tap(); assert.equal(q.status, 'no_current_book');
    await db.exec("update public.nfc_pending_starts set tapped_at=now()-interval '1 day'");
    const s = await control(q.request_id, 'select', bookId(1));
    assert.equal(s.status, 'started'); assert.equal(s.book_id, bookId(1));
    assert.ok(Math.abs(Date.now() - Date.parse(s.started_at)) < 2000);
    assert.equal((await rows('nfc_pending_starts')).length, 0);
    assert.equal((await db.query('select overall_status from public.library_entries where book_id=$1', [bookId(1)])).rows[0].overall_status, 'Currently Reading');
    assert.ok((await rows('library_events')).some(e => e.event_type === 'reading_started'));
  });
  await scenario('Start and Resume follow genuine activity behind an unchanged hard pin', async () => {
    await db.query('update public.nfc_bookmarks set pinned_book_id=$1 where id=$2', [bookId(99), bookmark]);
    const lifecycle = await start(1); await call('pause_reading', [bookId(1), 'frontend']); await start(1);
    const b = (await rows('nfc_bookmarks')).find(b => b.id === bookmark);
    assert.equal(b.active_book_id, bookId(1)); assert.equal(b.pinned_book_id, bookId(99));
    assert.equal((await db.query('select id from public.reading_sessions where book_id=$1 and status=$2', [bookId(1), 'Reading'])).rows[0].id, lifecycle);
    assert.equal((await tap()).book_id, bookId(99));
  });
  await scenario('second tap ends the exact original record despite default changes', async () => {
    const s = await tap(); await age(); await start(1);
    const ended = await tap(secondBookmark); assert.equal(ended.session_id, s.session_id); assert.equal(ended.book_id, bookId(99));
    assert.equal((await tap()).status, 'awaiting_page'); assert.equal((await rows('reading_time_sessions')).length, 1);
  });
  await scenario('rapid scan safely ignores duplicate and preserves unresolved unique constraint', async () => {
    await tap(); assert.equal((await tap(secondBookmark)).status, 'duplicate_ignored');
    assert.equal((await call('tap_nfc_bookmark', [bookmark, 'ff'.repeat(32)])).status, 'unauthorized');
    assert.equal((await rows('reading_time_sessions')).length, 1);
  });
  await scenario('running Change keeps identity/time and relinks canonical lifecycle, edition and page', async () => {
    const s = await tap(); const before = (await rows('reading_time_sessions'))[0];
    const edition = '60000000-0000-0000-0000-000000000001';
    await db.query('insert into public.editions(id,book_id,page_count) values($1,$2,608)', [edition, bookId(1)]);
    await db.query('update public.library_entries set current_edition_id=$1 where book_id=$2', [edition, bookId(1)]);
    await control(s.session_id, 'change', bookId(1));
    const after = (await rows('reading_time_sessions'))[0];
    assert.equal(after.id, before.id); assert.equal(after.started_at.getTime(), before.started_at.getTime());
    assert.equal(after.edition_id, edition); assert.equal(after.book_id, bookId(1)); assert.equal(after.start_page, 0);
    assert.equal((await db.query('select book_id from public.reading_sessions where id=$1', [after.reading_session_id])).rows[0].book_id, bookId(1));
    assert.ok((await rows('nfc_bookmarks')).every(b => b.active_book_id === bookId(1)));
  });
  await scenario('pending finish Change preserves ended_at and relinks current canonical page', async () => {
    const s = await tap(); await age(); const ended = await tap();
    await start(1); await call('update_reading_progress', [bookId(1), 12, 'manual']);
    const changed = await control(s.session_id, 'change', bookId(1));
    assert.equal(changed.ended_at, ended.ended_at); assert.equal(changed.started_at, ended.started_at);
    assert.equal((await rows('reading_time_sessions'))[0].start_page, 12);
    await call('finish_nfc_reading_session', [s.session_id, 47, false]);
    await call('finish_nfc_reading_session', [s.session_id, 48, false]);
    assert.equal((await rows('progress_logs')).filter(p => p.source === 'nfc').length, 1);
  });
  await scenario('Restart keeps record, resets timestamp/page and cannot restart ended state', async () => {
    const s = await tap(); await age(); await call('update_reading_progress', [bookId(99), 280, 'frontend']);
    const restarted = await control(s.session_id, 'restart');
    assert.equal(restarted.session_id, s.session_id); assert.ok(Math.abs(Date.now() - Date.parse(restarted.started_at)) < 2000);
    assert.equal((await rows('reading_time_sessions'))[0].start_page, 280);
    await control(s.session_id, 'end'); await assert.rejects(control(s.session_id, 'restart'), /Only a running/);
  });
  await scenario('End from app is idempotent, finish wins routing, NFC returns awaiting_page', async () => {
    const s = await tap(); assert.equal((await call('nfc_session_destination')).name, 'reading-session-active');
    const ended = await control(s.session_id, 'end');
    assert.equal((await control(s.session_id, 'end')).ended_at, ended.ended_at);
    assert.equal((await tap()).status, 'awaiting_page');
    assert.equal((await call('nfc_session_destination')).name, 'reading-session-finish');
  });
  await scenario('server destination priority is finish, running, selection, Home', async () => {
    assert.equal(await call('nfc_session_destination'), null);
    const s = await tap();
    await db.query("insert into public.nfc_pending_starts(user_id,bookmark_id,tapped_at,reason) values($1,$2,now(),'needs_book_selection')", [owner, bookmark]);
    assert.equal((await call('nfc_session_destination')).name, 'reading-session-active');
    await control(s.session_id, 'end'); assert.equal((await call('nfc_session_destination')).name, 'reading-session-finish');
    await call('finish_nfc_reading_session', [s.session_id, null, true]);
    const destination = await call('nfc_session_destination'); assert.equal(destination.name, 'reading-session-choose');
    await control(destination.sessionId, 'cancel'); assert.equal(await call('nfc_session_destination'), null);
  });
  await scenario('submitted/skipped identity cannot be rewritten and invalid/reversed progress is rejected', async () => {
    const s = await tap(); await control(s.session_id, 'end');
    for (const page of [-1, 272, 500]) await assert.rejects(call('finish_nfc_reading_session', [s.session_id, page, false]), /non-negative|reverse|exceeds/);
    await call('finish_nfc_reading_session', [s.session_id, null, true]);
    await assert.rejects(control(s.session_id, 'change', bookId(1)), /already saved or skipped/);
    await assert.rejects(control(s.session_id, 'restart'), /already saved or skipped/);
    assert.equal(await call('nfc_session_destination'), null);
  });
  await scenario('submitted session rejects change', async () => {
    const s = await tap(); await control(s.session_id, 'end'); await call('finish_nfc_reading_session', [s.session_id, 280, false]);
    await assert.rejects(control(s.session_id, 'change', bookId(1)), /already saved or skipped/);
  });
  await scenario('changing to another owner or finished book never starts parallel lifecycle', async () => {
    const s = await tap(); await db.query('update public.library_entries set user_id=$1 where book_id=$2', [other, bookId(1)]);
    await assert.rejects(control(s.session_id, 'change', bookId(1)), /not in your library/);
    await db.query("update public.library_entries set overall_status='Read' where book_id=$1", [bookId(2)]);
    await assert.rejects(control(s.session_id, 'change', bookId(2)), /normal book controls/);
    assert.equal((await rows('reading_time_sessions'))[0].book_id, bookId(99));
  });
  await scenario('service-only tap works without JWT and token rotation is respected', async () => {
    await db.exec("set local role service_role; select set_config('request.jwt.claim.sub','',true)");
    assert.equal((await tap()).status, 'started');
    assert.equal((await call('tap_nfc_bookmark', [bookmark, 'ff'.repeat(32)])).status, 'unauthorized');
  });
  await scenario('other user cannot view, reassign, restart, end, submit, cancel or select private NFC state', async () => {
    const s = await tap();
    await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${other}',true)`);
    assert.equal((await rows('reading_time_sessions')).length, 0); assert.equal((await rows('nfc_pending_starts')).length, 0);
    for (const action of ['change','restart','end','select','cancel']) await assert.rejects(control(s.session_id, action, bookId(1)), /Not authorized/);
    await assert.rejects(call('finish_nfc_reading_session', [s.session_id, 280, false]), /Not authorized/);
    await assert.rejects(call('nfc_session_destination'), /Not authorized/);
  });
  await scenario('browser/anon cannot read hash or directly mutate timed/default/pending state', async () => {
    const check = async (sql, allowed) => assert.equal((await db.query(sql)).rows[0].allowed, allowed);
    await check("select has_column_privilege('authenticated','public.nfc_bookmarks','token_hash','SELECT') allowed", false);
    await check("select has_column_privilege('authenticated','public.nfc_bookmarks','active_book_id','UPDATE') allowed", false);
    for (const table of ['reading_time_sessions','nfc_pending_starts']) {
      await check(`select has_table_privilege('anon','public.${table}','SELECT') allowed`, false);
      await check(`select has_table_privilege('authenticated','public.${table}','UPDATE') allowed`, false);
    }
    for (const name of ['public.control_nfc_session(uuid,text,uuid)','private.control_nfc_session(uuid,text,uuid)','public.nfc_session_destination()']) await check(`select has_function_privilege('anon','${name}','EXECUTE') allowed`, false);
    await db.exec('set local role anon'); await assert.rejects(control(bookmark, 'end'), /permission denied/);
  });
});

test('duration and live finish statistics handle valid/invalid pages and short sessions', () => {
  const s = { started_at: '2026-10-03T20:14:00Z', ended_at: '2026-10-03T20:56:18Z', start_page: 12, book: { current_page: 12, total_pages: 200 } };
  assert.equal(durationHms(durationSeconds(s)), '00:42:18');
  assert.deepEqual(sessionStats(s, '47'), { valid: true, pages: 35, pace: '49.6', minimum: 12 });
  assert.equal(sessionStats(s, '12').pace, '0.0');
  for (const page of ['', '-1', '11', '201', '13.2', 'NaN']) { assert.equal(sessionStats(s, page).valid, false); assert.equal(sessionStats(s, page).pace, null); }
  assert.equal(sessionStats({ ...s, book: { current_page: 12 } }, '500').valid, true);
  for (const seconds of [0, 1, 59]) assert.equal(sessionStats({ ...s, ended_at: new Date(Date.parse(s.started_at) + seconds * 1000).toISOString() }, '47').pace, null);
  assert.equal(durationHms(360001), '100:00:01');
  assert.equal(durationHms(NaN), '00:00:00');
});

test('rollback-backed live acceptance script runs against the actual PostgreSQL migrations', async t => {
  const db = await plannerDb(); t.after(() => db.close());
  await db.exec(await readFile('supabase/migrations/20261001190514_nfc_reading_sessions.sql', 'utf8'));
  await db.exec(await readFile(extension, 'utf8'));
  await db.exec('grant select,update on public.library_entries,public.reading_sessions to service_role; grant select on public.books,public.progress_logs,public.library_events to service_role');
  const result = await db.exec(await readFile('tests/sql/active-nfc-sessions-live.sql', 'utf8'));
  assert.match(result.at(-1).rows[0].result, /passed.*rolled back/);
  assert.equal((await db.query('select count(*)::int n from public.books')).rows[0].n, 0);
  assert.equal((await db.query('select owner_user_id from private.app_state')).rows[0].owner_user_id, owner);
});

test('lifecycle checks deduplicate foreground events and discard stale routes/users', async () => {
  let queries = 0, redirects = 0, allowed = true, user = 'owner', time = 1000, resolve;
  const check = createNfcLifecycleCheck({ load: () => { queries++; return new Promise(r => { resolve = r; }); }, allowed: () => allowed, identity: () => user, now: () => time, navigate: () => redirects++ });
  const first = check(); const second = check(); assert.equal(queries, 1);
  resolve({ name: 'reading-session-active' }); await Promise.all([first, second]); assert.equal(redirects, 1);
  await check(); assert.equal(queries, 1);
  time += 1000; const staleRoute = check(); allowed = false; resolve({ name: 'reading-session-active' }); await staleRoute; assert.equal(redirects, 1);
  time += 1000; allowed = true; const staleUser = check(); user = 'other'; resolve({ name: 'reading-session-finish' }); await staleUser; assert.equal(redirects, 1);
  allowed = false; await check(); assert.equal(queries, 3);
});

test('active and selection routes round trip', () => {
  for (const type of ['active','finish','choose']) {
    const hash = `#/reading-session/session-id/${type}`;
    assert.equal(routeHash(parseRoute(hash)), hash);
  }
});

test('Edge duration notification contract and persisted selection return successful responses', async () => {
  const token = `${bookmark}.${'cd'.repeat(32)}`, hash = await tokenHash(token);
  const request = () => new Request('https://example.test', { method: 'POST', headers: { 'X-NFC-Bookmark-Token': token } });
  for (const status of ['ended','awaiting_page','no_current_book','needs_book_selection']) {
    const response = await handleNfcRequest(request(), { appBaseUrl: 'https://bojango.github.io/Librariangpt/', lookupBookmark: async () => ({ enabled: true, token_hash: hash }), tapBookmark: async () => ({ status, session_id: 'fixture', duration_seconds: 2538 }) });
    assert.equal(response.status, 200); const result = await response.json();
    if (status === 'ended' || status === 'awaiting_page') assert.equal(result.duration_hms, '00:42:18');
    else assert.equal(result.open_url, 'https://bojango.github.io/Librariangpt/');
  }
});
