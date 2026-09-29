import test from 'node:test';
import assert from 'node:assert/strict';
import { plannerDb, seed, rpc, queue, owner, other, bookId, sessionId, appetite } from '../helpers/planner-db.js';

test('contextual next-read planner executes its real PostgreSQL migration and RPCs', async t => {
  const db = await plannerDb();
  t.after(() => db.close());
  await seed(db);
  const scenario = (name, run) => t.test(name, async () => {
    await db.exec('begin');
    try { await run(); } finally { await db.exec('rollback'); }
  });
  const unowned = async (n, score = 9.9) => {
    await db.query("insert into public.books(id,title,fiction_nonfiction,primary_genre) values($1,$2,'Nonfiction','Reportage')", [bookId(n), `Unowned reportage ${n}`]);
    await db.query("insert into public.library_entries(user_id,book_id,overall_status,ownership_status,total_pages) values($1,$2,'Wishlist','Not Owned',240)", [owner, bookId(n)]);
    await db.query("insert into public.recommendations(user_id,book_id,match_score_10,recommendation_strength) values($1,$2,$3,'Strong')", [owner, bookId(n), score]);
  };

  await scenario('eight candidates, no duplicates, deterministic refresh and reserve promotion', async () => {
    await rpc(db, 'refresh_up_next');
    const first = await queue(db);
    assert.equal(first.length, 8);
    assert.equal(new Set(first.map(x => x.book_id)).size, 8);
    await rpc(db, 'refresh_up_next');
    assert.deepEqual((await queue(db)).map(x => x.book_id), first.map(x => x.book_id));
    await rpc(db, 'up_next_remove', [first[0].id]);
    const promoted = await queue(db);
    assert.equal(promoted.length, 8);
    assert.equal(promoted[0].book_id, first[1].book_id);
    assert.ok(!promoted.some(x => x.book_id === first[0].book_id));
    await rpc(db, 'refresh_up_next');
    assert.ok(!(await queue(db)).some(x => x.book_id === first[0].book_id));
    await rpc(db, 'up_next_add', [first[0].book_id]);
    assert.ok((await queue(db)).some(x => x.book_id === first[0].book_id));
  });

  await scenario('availability structurally protects six of eight and four of five slots', async () => {
    for (let n = 20; n < 28; n++) await unowned(n);
    await rpc(db, 'refresh_up_next');
    const rows = await queue(db);
    const unownedIds = new Set(Array.from({ length: 8 }, (_, i) => bookId(20 + i)));
    assert.equal(rows.length, 8);
    assert.ok(rows.filter(row => !unownedIds.has(row.book_id)).length >= 6);
    assert.ok(rows.slice(0, 5).filter(row => !unownedIds.has(row.book_id)).length >= 4);
    assert.ok(!unownedIds.has(rows[0].book_id));
    assert.ok(rows.every(row => row.ai_score != null && Number(row.ai_score) >= 1 && Number(row.ai_score) <= 10));
    assert.ok(rows.every(row => row.reason && row.reason.includes('Short nonfiction')));
    assert.ok(rows.every(row => !/\\b\\d+ pages|\\bOwned\\b|\\bNext Fit\\b/i.test(row.reason)));
    const recommendation = (await db.query('select match_score_10 from public.recommendations where book_id=$1', [rows[0].book_id])).rows[0];
    assert.notEqual(Number(rows[0].ai_score), Number(recommendation.match_score_10));
    assert.equal((await db.query('select ai_score from public.v_up_next where id=$1', [rows[0].book_id])).rows[0].ai_score, rows[0].ai_score);
  });

  await scenario('an exceptional unowned appetite match can enter, without taking first place', async () => {
    for (let n = 20; n < 28; n++) await unowned(n, n === 20 ? 10 : 8);
    await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'exceptional-unowned']);
    const rows = await queue(db);
    assert.ok(rows.some(row => row.book_id === bookId(20)));
    assert.notEqual(rows[0].book_id, bookId(20));
    const c = (await rpc(db, 'next_read_planning_snapshot')).candidates.find(x => x.book_id === bookId(20));
    assert.equal(c.exceptional_unowned, true);
  });

  await scenario('reliably arriving On Order book can take first place when no owned book is viable', async () => {
    await db.query("update public.library_entries set overall_status='DNF' where book_id<>$1 and overall_status='Owned - Unread'", [bookId(1)]);
    await db.query("insert into public.progress_logs(user_id,session_id,book_id,page,total_pages_snapshot,logged_at) values($1,$2,$3,200,364,now()-interval '5 days'),($1,$2,$3,273,364,now())", [owner, sessionId, bookId(99)]);
    await rpc(db, 'set_book_availability', [bookId(1), 'On Order', new Date().toISOString().slice(0, 10)]);
    await rpc(db, 'refresh_up_next');
    assert.equal((await queue(db))[0].book_id, bookId(1));
  });

  await scenario('intent beats long SF compatibility and never writes taste, feedback or recommendation history', async () => {
    const tables = ['taste_profile', 'taste_evidence', 'reading_feedback', 'recommendations'];
    const before = await Promise.all(tables.map(table => db.query(`select * from public.${table} order by id`)));
    await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'appetite-1']);
    assert.notEqual((await queue(db))[0].book_id, bookId(1));
    const snapshot = await rpc(db, 'next_read_planning_snapshot');
    const long = snapshot.candidates.find(x => x.book_id === bookId(1));
    assert.equal(long.desired, true);
    assert.ok(long.conflicts > 0);
    assert.equal(snapshot.active_intent.context, appetite.context);
    const after = await Promise.all(tables.map(table => db.query(`select * from public.${table} order by id`)));
    assert.deepEqual(after.map(x => x.rows), before.map(x => x.rows));
  });

  await scenario('reasons use recorded subjects and temporary appetite without reciting metadata', async () => {
    await db.query("update public.books set themes_tags=array['Ecology','Fieldwork'] where id=$1", [bookId(2)]);
    await db.query("insert into public.taste_profile(user_id,dimension,preference,direction,confidence) values($1,'Reportage','Interested','Positive','High')", [owner]);
    await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'reason-evidence']);
    const selected = (await queue(db)).find(row => row.book_id === bookId(2));
    assert.ok(selected);
    assert.match(selected.reason, /Current long thriller/);
    assert.match(selected.reason, /ecology/);
    assert.match(selected.reason, /nonfiction/);
    assert.match(selected.reason, /established taste/);
    assert.doesNotMatch(selected.reason, /reading feedback/);
    assert.ok(selected.reason.trim().split(/\s+/).length >= 35);
    assert.doesNotMatch(selected.reason, /\b\d+ pages|\bOwned\b|\bNext Fit\b/i);
  });

  await scenario('locked positions and manual ordering survive repeated AI refreshes', async () => {
    await rpc(db, 'up_next_add', [bookId(1)]);
    await rpc(db, 'refresh_up_next');
    let q = await queue(db);
    await rpc(db, 'up_next_set_locked', [q[0].id, true]);
    await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'locks']);
    assert.equal((await queue(db))[0].book_id, bookId(1));
    await assert.rejects(rpc(db, 'up_next_add', [bookId(1), 'AI', 'overwrite', false]), /locked/);
    q = await queue(db);
    [q[1], q[2]] = [q[2], q[1]];
    await rpc(db, 'up_next_reorder', [q.map(x => x.id)]);
    await rpc(db, 'refresh_up_next');
    assert.deepEqual((await queue(db)).slice(0, 3).map(x => x.id), q.slice(0, 3).map(x => x.id));
    assert.ok((await queue(db)).slice(0, 3).every(x => x.ai_score != null));
    await assert.rejects(rpc(db, 'up_next_reorder', [[q[0].id, q[0].id]]), /exactly once/);
  });

  await scenario('purchase recency decays over 45 days and cannot override contradictory appetite', async () => {
    for (const [n, days] of [[1, 0], [2, 22.5], [3, 46]]) {
      await db.query(`insert into public.library_events(user_id,book_id,event_type,payload,occurred_at)
        values($1,$2,'ownership_changed','{"ownership_status":"Owned"}',now()-$3*interval '1 day')`, [owner, bookId(n), days]);
    }
    await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'purchase']);
    const { candidates } = await rpc(db, 'next_read_planning_snapshot');
    assert.equal(candidates.find(x => x.book_id === bookId(1)).acquisition_signal, 1);
    assert.equal(candidates.find(x => x.book_id === bookId(2)).acquisition_signal, 0.5);
    assert.equal(candidates.find(x => x.book_id === bookId(3)).acquisition_signal, 0);
    assert.notEqual((await queue(db))[0].book_id, bookId(1));
  });

  await scenario('On Order eligible but unavailable book cannot automatically take first place', async () => {
    await db.query("update public.library_entries set reading_priority='High' where book_id=$1", [bookId(1)]);
    await rpc(db, 'set_book_availability', [bookId(1), 'On Order', null]);
    await rpc(db, 'refresh_up_next');
    const q = await queue(db);
    assert.notEqual(q[0].book_id, bookId(1));
    assert.ok(q.some(x => x.book_id === bookId(1)));
    const { candidates } = await rpc(db, 'next_read_planning_snapshot');
    assert.equal(candidates.find(x => x.book_id === bookId(1)).availability, 0);
    await rpc(db, 'set_book_availability', [bookId(1), 'Owned']);
    const owned = (await rpc(db, 'next_read_planning_snapshot')).candidates.find(x => x.book_id === bookId(1));
    assert.equal(owned.availability, 2);
    assert.equal(owned.order_signal, 0);
  });

  await scenario('arrival estimate requires progress evidence and remains weaker than ownership', async () => {
    await db.query(`insert into public.progress_logs(user_id,session_id,book_id,page,total_pages_snapshot,logged_at)
      values($1,$2,$3,200,364,now()-interval '5 days'),($1,$2,$3,273,364,now())`, [owner, sessionId, bookId(99)]);
    await rpc(db, 'set_book_availability', [bookId(1), 'On Order', new Date().toISOString().slice(0, 10)]);
    const c = (await rpc(db, 'next_read_planning_snapshot')).candidates.find(x => x.book_id === bookId(1));
    assert.equal(c.availability, 1);
    await rpc(db, 'refresh_up_next');
    assert.notEqual((await queue(db))[0].book_id, bookId(1));
  });

  await scenario('Read, DNF, Not Interested and dismissed recommendations excluded even if locked', async () => {
    await rpc(db, 'up_next_add', [bookId(1)]);
    for (const [n, status] of [[1, 'Read'], [2, 'DNF'], [3, 'Not Interested']]) {
      await db.query('update public.library_entries set overall_status=$1 where book_id=$2', [status, bookId(n)]);
    }
    await db.query("update public.recommendations set recommendation_status='Dismissed' where book_id=$1", [bookId(4)]);
    await rpc(db, 'refresh_up_next');
    assert.ok((await queue(db)).every(x => ![1, 2, 3, 4].map(bookId).includes(x.book_id)));
    await assert.rejects(rpc(db, 'up_next_add', [bookId(1)]), /not eligible/);
  });

  await scenario('new book closes intent; retries cannot resurrect it or repeatedly ask', async () => {
    let snapshot = await rpc(db, 'next_read_planning_snapshot');
    assert.equal(snapshot.transitions.find(x => x.session_id === sessionId).should_capture_intent, true);
    assert.equal((await rpc(db, 'acknowledge_next_read_transition', [sessionId, 'asked'])).acknowledged, true);
    assert.equal((await rpc(db, 'acknowledge_next_read_transition', [sessionId, 'asked'])).acknowledged, false);
    assert.equal((await rpc(db, 'next_read_planning_snapshot')).transitions[0].should_capture_intent, false);
    const saved = await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'retry']);
    const duplicate = await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'retry']);
    assert.equal(duplicate.intent_id, saved.intent_id);
    assert.equal(duplicate.duplicate, true);
    await assert.rejects(rpc(db, 'save_next_read_intent', [sessionId, {}, 'retry']), /different intent/);
    await rpc(db, 'start_reading', [bookId(2)]);
    snapshot = await rpc(db, 'next_read_planning_snapshot');
    assert.equal(snapshot.active_intent, null);
    assert.equal(snapshot.transitions.find(x => x.session_id === sessionId).should_capture_intent, false);
    assert.ok(!(await queue(db)).some(x => x.book_id === bookId(2)));
    assert.equal((await queue(db)).length, 8);
    assert.equal((await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'retry'])).state, 'expired');
    const history = (await db.query('select * from public.next_read_intents')).rows;
    assert.equal(history[0].expiry_reason, 'next_book_started');
  });

  await scenario('planning threshold uses session progress and genre families include SF subgenres', async () => {
    await db.query('update public.reading_sessions set current_page=271 where id=$1', [sessionId]);
    let transition = (await rpc(db, 'next_read_planning_snapshot')).transitions[0];
    assert.equal(transition.progress_percent, 74.5);
    assert.equal(transition.should_capture_intent, false);
    await db.query('update public.reading_sessions set current_page=292 where id=$1', [sessionId]);
    assert.equal((await rpc(db, 'next_read_planning_snapshot')).transitions[0].should_capture_intent, true);
    await db.query("update public.books set primary_genre='Hard Science Fiction' where id=$1", [bookId(1)]);
    await rpc(db, 'save_next_read_intent', [sessionId, { avoided_genres: ['Science Fiction'] }, 'genre-family']);
    assert.equal((await rpc(db, 'next_read_planning_snapshot')).candidates.find(c => c.book_id === bookId(1)).conflicts, 1);
  });

  await scenario('ownership edits create acquisition events once; later metadata edits do not renew recency', async () => {
    await db.query("update public.library_entries set ownership_status='On Order' where book_id=$1", [bookId(2)]);
    await db.query("update public.library_entries set ownership_status='Owned' where book_id=$1", [bookId(2)]);
    await db.query("update public.library_entries set notes='Changed metadata only' where book_id=$1", [bookId(2)]);
    const events = (await db.query('select event_type from public.library_events where book_id=$1 order by id', [bookId(2)])).rows;
    assert.deepEqual(events.map(e => e.event_type), ['purchase_ordered', 'ownership_changed']);
  });

  await scenario('pause/DNF/finish and a strong new recommendation request re-evaluation', async () => {
    await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'lifecycle']);
    await rpc(db, 'pause_reading', [bookId(99)]);
    assert.equal((await rpc(db, 'next_read_planning_snapshot')).active_intent.state, 'active');
    await rpc(db, 'dnf_reading', [bookId(99)]);
    assert.ok(!(await queue(db)).some(x => x.book_id === bookId(99)));
    await rpc(db, 'start_reading', [bookId(2)]);
    await rpc(db, 'finish_reading', [bookId(2)]);
    assert.ok(!(await queue(db)).some(x => x.book_id === bookId(2)));
    await rpc(db, 'refresh_up_next');
    await db.query(`insert into public.recommendations(user_id,book_id,match_score_10) values($1,$2,7)`, [owner, bookId(3)]);
    assert.equal((await rpc(db, 'refresh_up_next', ['snapshot', false])).refreshed, false);
    await db.query(`insert into public.recommendations(user_id,book_id,match_score_10) values($1,$2,9.8)`, [owner, bookId(3)]);
    assert.equal((await rpc(db, 'refresh_up_next', ['snapshot', false])).refreshed, true);
  });

  await scenario('sparse library returns only viable books; invalid saves leave existing intent intact', async () => {
    await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'valid']);
    await assert.rejects(rpc(db, 'save_next_read_intent', [sessionId, { preferred_max_pages: -1 }, 'invalid']), /check constraint/);
    assert.equal((await rpc(db, 'next_read_planning_snapshot')).active_intent.request_key, 'valid');
    await db.query("update public.library_entries set overall_status='Not Interested' where book_id<>$1 and book_id<>$2", [bookId(2), bookId(99)]);
    await rpc(db, 'refresh_up_next');
    assert.equal((await queue(db)).length, 1);
  });

  await scenario('replacement preserves historical intent, explicit deferral leaves candidate inspectable', async () => {
    await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'original']);
    await rpc(db, 'save_next_read_intent', [sessionId, { deferred_book_ids: [bookId(1)] }, 'replacement']);
    const all = (await db.query('select * from public.next_read_intents')).rows;
    assert.equal(all.length, 2);
    assert.equal(all.filter(x => x.state === 'active').length, 1);
    const { candidates } = await rpc(db, 'next_read_planning_snapshot');
    assert.equal(candidates.at(-1).book_id, bookId(1));
    await rpc(db, 'expire_next_read_intent', ['transition_passed']);
    assert.equal((await rpc(db, 'next_read_planning_snapshot')).active_intent, null);
  });

  await scenario('tiny progress/metadata edits do not refresh; meaningful model and availability changes do', async () => {
    await rpc(db, 'refresh_up_next');
    await db.query('update public.library_entries set current_page=274 where book_id=$1', [bookId(99)]);
    assert.equal((await rpc(db, 'refresh_up_next', ['snapshot', false])).refreshed, false);
    await db.query(`insert into public.taste_profile(user_id,dimension,preference,direction,confidence)
      values($1,'Exploration','Enjoys exploration','Positive','High')`, [owner]);
    assert.equal((await rpc(db, 'refresh_up_next', ['snapshot', false])).refreshed, true);
    const before = (await rpc(db, 'next_read_planning_snapshot')).candidates[0].taste_signal;
    assert.ok(before > 0);
    await db.query(`insert into public.reading_feedback(user_id,book_id,user_feedback,aspect,sentiment,evidence_strength,generalisable)
      values($1,$2,'Enjoys exploration','Exploration','Positive','Strong',true)`, [owner, bookId(99)]);
    assert.equal((await rpc(db, 'refresh_up_next', ['snapshot', false])).refreshed, true);
    assert.ok((await rpc(db, 'next_read_planning_snapshot')).candidates[0].feedback_signal > 0);
  });

  await scenario('owner-only RPCs, private internals, RLS and service bridge authorization', async () => {
    await rpc(db, 'save_next_read_intent', [sessionId, appetite, 'security']);
    await db.exec('set local role authenticated');
    assert.equal((await rpc(db, 'next_read_planning_snapshot')).active_intent.user_id, owner);
    await db.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
    assert.equal((await db.query('select * from public.next_read_intents')).rows.length, 0);
    await db.exec('savepoint unauthorized');
    await assert.rejects(rpc(db, 'next_read_planning_snapshot'), /Not authorized/);
    await db.exec('rollback to savepoint unauthorized');
    const privileges = (await db.query(`select has_function_privilege('anon','public.refresh_up_next(text,boolean)','execute') anon,
      has_function_privilege('authenticated','private.refresh_next_read(uuid,text,boolean)','execute') internal,
      has_table_privilege('authenticated','public.up_next_queue','update') direct_write`)).rows[0];
    assert.deepEqual(privileges, { anon: false, internal: false, direct_write: false });
    await db.exec(`reset role; set local role service_role;
      select set_config('request.jwt.claim.sub','',true);
      select set_config('request.jwt.claims','{"role":"service_role"}',true)`);
    assert.equal((await rpc(db, 'next_read_planning_snapshot')).active_intent.user_id, owner);
  });
});
