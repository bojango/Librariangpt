import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleBridgeRequest } from '../../supabase/functions/reading-checkin-bridge/core.js';

const READ_TOKEN = 'r'.repeat(64);
const WRITE_TOKEN = 'w'.repeat(64);
const BOOK_ID = '11111111-1111-4111-8111-111111111111';

function dependencies(overrides = {}) {
  return {
    readToken: READ_TOKEN,
    writeToken: WRITE_TOKEN,
    readSnapshot: async () => ({ state: { current_book: { book_id: BOOK_ID } } }),
    saveNote: async () => ({ ok: true, saved: true, duplicate: false, id: BOOK_ID, generated_at: '2026-09-13T18:00:00Z' }),
    ...overrides,
  };
}

async function body(response) {
  return response.json();
}

test('bridge rejects missing and wrong credentials without revealing tokens', async () => {
  for (const token of ['', 'wrong']) {
    const response = await handleBridgeRequest(
      new Request(`https://example.test/bridge?action=snapshot&token=${token}`),
      dependencies(),
    );
    assert.equal(response.status, 401);
    const text = await response.text();
    assert.equal(text.includes(READ_TOKEN), false);
    assert.equal(text.includes(WRITE_TOKEN), false);
    assert.deepEqual(JSON.parse(text), { ok: false, error: 'invalid_credentials' });
  }
});

test('read token returns only the canonical snapshot and cannot select a user', async () => {
  let reads = 0;
  const response = await handleBridgeRequest(
    new Request(`https://example.test/bridge?action=snapshot&token=${READ_TOKEN}&user_id=attacker&table=books`),
    dependencies({ readSnapshot: async () => { reads += 1; return { canonical: true }; } }),
  );
  assert.equal(response.status, 200);
  assert.equal(reads, 1);
  assert.deepEqual(await body(response), { ok: true, snapshot: { canonical: true }, bridge_version: 1 });
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
  assert.equal(response.headers.get('pragma'), 'no-cache');
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
});

test('read and write tokens are not interchangeable', async () => {
  let writes = 0;
  const deps = dependencies({ saveNote: async () => { writes += 1; return { ok: true }; } });
  const readOnWrite = await handleBridgeRequest(
    new Request(`https://example.test/bridge?action=note&token=${READ_TOKEN}&note=hello`), deps,
  );
  const writeOnRead = await handleBridgeRequest(
    new Request(`https://example.test/bridge?action=snapshot&token=${WRITE_TOKEN}`), deps,
  );
  assert.equal(readOnWrite.status, 401);
  assert.equal(writeOnRead.status, 401);
  assert.equal(writes, 0);
});

test('GET compatibility and POST send the same validated note payload', async () => {
  const payloads = [];
  const deps = dependencies({
    saveNote: async payload => {
      payloads.push(payload);
      return { ok: true, saved: true, duplicate: false, id: BOOK_ID, generated_at: 'now' };
    },
  });
  const query = new URLSearchParams({
    action: 'note', token: WRITE_TOKEN, book_id: BOOK_ID, page: '117',
    progress_percent: '42.5', note: '  A brief note.  ', chapter_number: '7', chapter_title: 'The Division',
  });
  const getResponse = await handleBridgeRequest(new Request(`https://example.test/bridge?${query}`), deps);
  const postResponse = await handleBridgeRequest(new Request('https://example.test/bridge', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'note', token: WRITE_TOKEN, book_id: BOOK_ID, page: 117,
      progress_percent: 42.5, note_text: '  A brief note.  ', chapter_number: '7', chapter_title: 'The Division',
    }),
  }), deps);
  assert.equal(getResponse.status, 200);
  assert.equal(postResponse.status, 200);
  assert.deepEqual(payloads[0], payloads[1]);
  assert.deepEqual(payloads[0], {
    p_note_text: 'A brief note.', p_book_id: BOOK_ID, p_page: 117,
    p_progress_percent: 42.5, p_chapter_number: '7', p_chapter_title: 'The Division',
  });
});

test('note validation rejects blank, oversized, malformed page, and malformed progress', async () => {
  const cases = [
    [`note=+++`, 'note_required'],
    [`note=${encodeURIComponent('x'.repeat(401))}`, 'note_too_long'],
    ['note=ok&page=-1', 'invalid_page'],
    ['note=ok&page=1.5', 'invalid_page'],
    ['note=ok&progress_percent=100.1', 'invalid_progress'],
    ['note=ok&progress_percent=NaN', 'invalid_progress'],
    ['note=ok&progress_percent=0x10', 'invalid_progress'],
  ];
  for (const [query, error] of cases) {
    const response = await handleBridgeRequest(
      new Request(`https://example.test/bridge?action=note&token=${WRITE_TOKEN}&${query}`),
      dependencies(),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await body(response), { ok: false, error });
  }
});

test('database validation results reject non-current, unrelated, and stale writes', async () => {
  for (const error of ['book_not_currently_reading', 'active_session_unavailable', 'stale_progress']) {
    const response = await handleBridgeRequest(
      new Request(`https://example.test/bridge?action=note&token=${WRITE_TOKEN}&note=ok&book_id=${BOOK_ID}`),
      dependencies({ saveNote: async () => ({ ok: false, error }) }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await body(response), { ok: false, error });
  }
});

test('an exact repeated GET is a no-op and does not create a second note', async () => {
  const seen = new Set();
  let inserts = 0;
  const deps = dependencies({
    saveNote: async payload => {
      const key = JSON.stringify(payload);
      if (seen.has(key)) return { ok: true, saved: false, duplicate: true, id: BOOK_ID, generated_at: 'now' };
      seen.add(key);
      inserts += 1;
      return { ok: true, saved: true, duplicate: false, id: BOOK_ID, generated_at: 'now' };
    },
  });
  const url = `https://example.test/bridge?action=note&token=${WRITE_TOKEN}&note=steady&book_id=${BOOK_ID}&page=12`;
  const first = await body(await handleBridgeRequest(new Request(url), deps));
  const second = await body(await handleBridgeRequest(new Request(url), deps));
  assert.equal(first.saved, true);
  assert.equal(second.saved, false);
  assert.equal(second.duplicate, true);
  assert.equal(inserts, 1);
});

test('unsupported actions, methods, and arbitrary operation names have no effect', async () => {
  let reads = 0;
  let writes = 0;
  const deps = dependencies({
    readSnapshot: async () => { reads += 1; return {}; },
    saveNote: async () => { writes += 1; return {}; },
  });
  for (const action of ['execute_sql', 'rpc', 'table', 'drop table books']) {
    const response = await handleBridgeRequest(
      new Request(`https://example.test/bridge?action=${encodeURIComponent(action)}&token=${WRITE_TOKEN}&sql=select+*+from+books`),
      deps,
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await body(response), { ok: false, error: 'unsupported_action' });
  }
  const put = await handleBridgeRequest(new Request('https://example.test/bridge', { method: 'PUT' }), deps);
  assert.equal(put.status, 405);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
});

test('OPTIONS is supported without credentialed or wildcard browser CORS', async () => {
  const response = await handleBridgeRequest(
    new Request('https://example.test/bridge', { method: 'OPTIONS' }), dependencies(),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store, private');
});

test('unexpected database failures return a stable minimal response', async () => {
  const response = await handleBridgeRequest(
    new Request(`https://example.test/bridge?action=snapshot&token=${READ_TOKEN}`),
    dependencies({ readSnapshot: async () => { throw new Error(`database failed ${READ_TOKEN}`); } }),
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), { ok: false, error: 'temporarily_unavailable' });
});

test('migration fixes owner internally and grants both bridge RPCs only to service_role', async () => {
  const sql = await readFile(new URL('../../supabase/migrations/20260913180154_add_reading_checkin_bridge_rpcs.sql', import.meta.url), 'utf8');
  assert.match(sql, /from private\.app_state s/);
  assert.match(sql, /return public\.reading_checkin_snapshot\(v_owner_id\)/);
  assert.doesNotMatch(sql, /p_user_id/);
  assert.match(sql, /le\.user_id = v_owner_id/);
  assert.match(sql, /le\.overall_status = 'Currently Reading'/);
  assert.match(sql, /active\.status = 'Reading'/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /interval '30 minutes'/);
  assert.match(sql, /revoke all on function public\.reading_checkin_bridge_snapshot\(\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.reading_checkin_bridge_snapshot\(\) to service_role/);
  assert.match(sql, /revoke all on function public\.save_reading_card_note_bridge[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.save_reading_card_note_bridge[\s\S]*to service_role/);
});
