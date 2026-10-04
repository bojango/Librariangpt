import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { plannerDb, seed, owner, other, bookId } from '../helpers/planner-db.js';
import { handleNfcRequest, tokenHash } from '../../supabase/functions/nfc-reading-session/core.js';
import { parseRoute, routeHash } from '../../src/router.js';
import { sameRoute } from '../../src/lifecycle.js';

const bookmarkId = '40000000-0000-0000-0000-000000000001';
const token = `${bookmarkId}.${'ab'.repeat(32)}`;
const migration = 'supabase/migrations/20261001190514_nfc_reading_sessions.sql';

test('NFC executes actual PostgreSQL migration, tap and progress transactions', async t => {
  const db = await plannerDb(); t.after(() => db.close());
  await db.exec(await readFile(migration, 'utf8'));
  await seed(db);
  // Supabase platform defaults, absent from the embedded PostgreSQL fixture.
  await db.exec('grant select,update on public.library_entries,public.reading_sessions to service_role; grant select on public.books to service_role');
  const hash = await tokenHash(token);
  await db.query('insert into public.nfc_bookmarks(id,user_id,name,token_hash,token_hint) values($1,$2,$3,$4,$5)', [bookmarkId, owner, 'Test bookmark', hash, 'ababab']);
  const call = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => `$${i+1}`).join(',')}) result`, args)).rows[0].result;
  const tap = () => call('tap_nfc_bookmark', [bookmarkId, hash]);
  const scenario = (name, run) => t.test(name, async () => {
    await db.exec('begin');
    try { await run(); } finally { await db.exec('rollback'); }
  });
  const age = async () => {
    await db.exec("update public.nfc_bookmarks set last_tapped_at=clock_timestamp()-interval '30 seconds'; update public.reading_time_sessions set started_at=clock_timestamp()-interval '30 seconds'");
  };
  await scenario('first tap captures exact start, current book, lifecycle and start page', async () => {
    const result = await tap(); assert.equal(result.status, 'started');
    const s = (await db.query('select * from public.reading_time_sessions')).rows[0];
    assert.equal(s.start_page, 273); assert.equal(s.book_id, bookId(99));
    assert.ok(s.reading_session_id); assert.equal(s.ended_at, null);
    assert.ok(Math.abs(Date.now() - Date.parse(s.started_at)) < 2000);
  });
  await scenario('second tap ends same session, duration uses taps, delayed save writes normal progress and nfc source once', async () => {
    const start = await tap(); await age(); const end = await tap();
    assert.equal(end.status, 'ended'); assert.equal(end.session_id, start.session_id);
    assert.ok(end.duration_seconds >= 30);
    const endedAt = (await db.query('select ended_at from public.reading_time_sessions')).rows[0].ended_at;
    const saved = await call('finish_nfc_reading_session', [start.session_id, 280, false]);
    assert.equal(saved.status, 'submitted');
    await call('finish_nfc_reading_session', [start.session_id, 281, false]);
    const s = (await db.query('select * from public.reading_time_sessions')).rows[0];
    assert.equal(s.end_page, 280); assert.equal(s.ended_at.getTime(), endedAt.getTime()); assert.ok(s.progress_submitted_at);
    assert.equal((await db.query('select current_page from public.library_entries where book_id=$1', [bookId(99)])).rows[0].current_page, 280);
    assert.equal((await db.query('select current_page from public.reading_sessions where book_id=$1', [bookId(99)])).rows[0].current_page, 280);
    assert.deepEqual((await db.query('select page,source from public.progress_logs')).rows, [{ page: 280, source: 'nfc' }]);
    assert.equal((await db.query("select source from public.library_events where event_type='progress_updated'")).rows[0].source, 'nfc');
  });
  await scenario('rapid duplicate cannot end/create extra; third tap pending returns awaiting_page', async () => {
    const first = await tap(); assert.equal((await tap()).status, 'duplicate_ignored');
    assert.equal((await db.query('select ended_at from public.reading_time_sessions')).rows[0].ended_at, null);
    await age(); await tap();
    await db.exec("update public.nfc_bookmarks set last_tapped_at=clock_timestamp()-interval '11 seconds'");
    const third = await tap(); assert.equal(third.status, 'awaiting_page'); assert.equal(third.session_id, first.session_id);
    assert.equal((await db.query('select count(*)::int n from public.reading_time_sessions')).rows[0].n, 1);
  });
  await scenario('database constraint forbids multiple active or unresolved sessions even across bookmarks', async () => {
    await tap(); await db.exec('savepoint violation');
    await assert.rejects(db.query(`insert into public.reading_time_sessions(user_id,bookmark_id,book_id,started_at,start_page) values($1,$2,$3,now(),0)`, [owner, bookmarkId, bookId(99)]), /unique constraint/);
    await db.exec('rollback to savepoint violation');
  });
  await scenario('invalid and disabled tokens rejected in locked database transaction', async () => {
    assert.equal((await call('tap_nfc_bookmark', [bookmarkId, 'ff'.repeat(32)])).status, 'unauthorized');
    await db.exec('update public.nfc_bookmarks set enabled=false');
    assert.equal((await tap()).status, 'unauthorized');
    assert.equal((await db.query('select count(*)::int n from public.reading_time_sessions')).rows[0].n, 0);
  });
  await scenario('service role can run taps without a user JWT; missing lifecycle is refused', async () => {
    await db.exec("set local role service_role; select set_config('request.jwt.claim.sub','',true)");
    assert.equal((await tap()).status, 'started');
  });
  await scenario('an absent lifecycle never starts corrupt timed state', async () => {
    await db.exec("update public.reading_sessions set status='Paused'");
    assert.equal((await tap()).status, 'missing_reading_lifecycle');
  });
  await scenario('no current book and multiple books give structured responses; pin resolves ambiguity', async () => {
    await db.exec("update public.library_entries set overall_status='Paused' where overall_status='Currently Reading'");
    assert.equal((await tap()).status, 'no_current_book');
    await db.query("update public.library_entries set overall_status='Currently Reading' where book_id in ($1,$2)", [bookId(99), bookId(1)]);
    assert.equal((await tap()).status, 'needs_book_selection');
    await db.query('update public.nfc_bookmarks set pinned_book_id=$1', [bookId(99)]);
    assert.equal((await tap()).book_id, bookId(99));
  });
  await scenario('manual progress behaviour and source fallback preserved', async () => {
    assert.equal((await call('update_reading_progress', [bookId(99), 290, 'manual'])).page, 290);
    await call('update_reading_progress', [bookId(99), 291, 'unknown']);
    assert.deepEqual((await db.query('select source from public.progress_logs order by id')).rows.map(r => r.source), ['manual','frontend']);
  });
  await scenario('owner finish, skip and invalid page validation preserve ended timestamp and atomicity', async () => {
    const start = await tap(); await age(); await tap();
    await db.exec('savepoint invalid_page');
    await assert.rejects(call('finish_nfc_reading_session', [start.session_id, 500, false]), /exceeds total/);
    await db.exec('rollback to savepoint invalid_page');
    assert.equal((await db.query('select progress_state from public.reading_time_sessions')).rows[0].progress_state, 'pending');
    assert.equal((await call('finish_nfc_reading_session', [start.session_id, null, true])).status, 'skipped');
  });
  await scenario('changed lifecycle refuses old progress; explicit skip remains available', async () => {
    const start = await tap(); await age(); await tap();
    await db.exec("update public.reading_sessions set status='Paused'; savepoint changed_read");
    await assert.rejects(call('finish_nfc_reading_session', [start.session_id, 280, false]), /book or edition has changed/);
    await db.exec('rollback to savepoint changed_read');
    assert.equal((await call('finish_nfc_reading_session', [start.session_id, null, true])).status, 'skipped');
    assert.equal((await db.query('select count(*)::int n from public.progress_logs')).rows[0].n, 0);
  });
  await scenario('RLS hides sessions from other users, blocks finish, hides hashes and blocks direct tap', async () => {
    const s = await tap(); await age(); await tap();
    await db.exec(`set local role authenticated; select set_config('request.jwt.claim.sub','${other}',true)`);
    assert.equal((await db.query('select * from public.reading_time_sessions')).rows.length, 0);
    await db.exec('savepoint forbidden');
    await assert.rejects(call('finish_nfc_reading_session', [s.session_id, 280, false]), /Not authorized/);
    await db.exec('rollback to savepoint forbidden');
    await assert.rejects(db.query('select token_hash from public.nfc_bookmarks'), /permission denied/);
    await db.exec('rollback to savepoint forbidden');
    await assert.rejects(tap(), /permission denied/);
    await db.exec('rollback to savepoint forbidden');
    await db.exec(`select set_config('request.jwt.claim.sub','${owner}',true)`);
    assert.equal((await db.query('select * from public.reading_time_sessions')).rows.length, 1);
    assert.equal((await call('finish_nfc_reading_session', [s.session_id, 280, false])).status, 'submitted');
  });
  await scenario('browser owner can create/rotate/disable using column grants without reading hashes', async () => {
    await db.exec('set local role authenticated');
    const id = '40000000-0000-0000-0000-000000000002';
    await db.query('insert into public.nfc_bookmarks(id,user_id,name,token_hash,token_hint) values($1,$2,$3,$4,$5)', [id, owner, 'Browser bookmark', hash, 'hint']);
    await db.query('update public.nfc_bookmarks set token_hash=$1,enabled=false where id=$2', ['ff'.repeat(32), id]);
    assert.equal((await db.query('select enabled from public.nfc_bookmarks where id=$1', [id])).rows[0].enabled, false);
    assert.equal((await db.query("select has_column_privilege('authenticated','public.nfc_bookmarks','token_hash','SELECT') as allowed")).rows[0].allowed, false);
    assert.equal((await db.query("select has_table_privilege('anon','public.reading_time_sessions','SELECT') as allowed")).rows[0].allowed, false);
  });
  await db.exec(await readFile('supabase/rollback/nfc_reading_sessions.sql', 'utf8'));
  assert.equal((await db.query("select to_regclass('public.reading_time_sessions') as relation")).rows[0].relation, null);
  assert.equal((await call('update_reading_progress', [bookId(99), 274, 'manual'])).page, 274);
});

test('Edge handler authenticates capability before mutations and supplies full finish URLs', async () => {
  let calls = 0; const hash = await tokenHash(token);
  const deps = { appBaseUrl: 'https://bojango.github.io/Librariangpt/', lookupBookmark: async () => ({ enabled: true, token_hash: hash }),
    tapBookmark: async () => { calls++; return { status: 'ended', session_id: 'session-1', duration_seconds: 1234 }; } };
  const request = value => new Request('https://example.test/nfc', { method: 'POST', headers: { 'X-NFC-Bookmark-Token': value } });
  assert.equal((await handleNfcRequest(request(`${bookmarkId}.${'ff'.repeat(32)}`), deps)).status, 401);
  assert.equal((await handleNfcRequest(request(token), { ...deps, lookupBookmark: async () => ({ enabled: false, token_hash: hash }) })).status, 401);
  assert.equal(calls, 0);
  const result = await (await handleNfcRequest(request(token), deps)).json();
  assert.equal(result.finish_url, 'https://bojango.github.io/Librariangpt/#/reading-session/session-1/finish');
  assert.equal(result.duration_seconds, 1234); assert.equal(calls, 1);
  assert.equal((await handleNfcRequest(request(token), { ...deps, lookupBookmark: async () => null })).status, 401);
});

test('finish hash route round trips and session identities are distinct', () => {
  const route = parseRoute('#/reading-session/abc/finish');
  assert.equal(route.name, 'reading-session-finish'); assert.equal(route.sessionId, 'abc');
  assert.equal(routeHash(route), '#/reading-session/abc/finish');
  assert.equal(sameRoute(route, { ...route, sessionId: 'def' }), false);
});
