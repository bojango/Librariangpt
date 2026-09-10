import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics, createSupabaseDiagnosticUploader, sanitizeDiagnosticPayload } from '../../src/diagnostics/diagnostics.js';
import { createMemoryDiagnosticStorage } from '../../src/diagnostics/storage.js';

function localStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
}

test('disabled diagnostics performs no local writes or event collection', async () => {
  const storage = createMemoryDiagnosticStorage();
  const recorder = createDiagnostics({ storage, localStorage: localStore(), initialEnabled: false });
  assert.equal(recorder.event('paint_start'), null);
  await recorder.initialize();
  assert.equal(storage.writes, 0);
  assert.deepEqual(await recorder.listSessions(), []);
});

test('enabled diagnostics records ordered timestamps and immediate issue markers', async () => {
  const storage = createMemoryDiagnosticStorage();
  let monotonic = 10;
  const recorder = createDiagnostics({ storage, localStorage: localStore(), initialEnabled: true, monotonic: () => ++monotonic });
  recorder.configure({ context: () => ({ route: { name: 'home' } }) });
  await recorder.initialize();
  recorder.event('route_render_start', { render_generation: 1 });
  await recorder.markIssue('scroll_jump');
  const events = await recorder.events();
  assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
  assert.ok(events.every(event => event.timestamp_wall && Number.isFinite(event.timestamp_monotonic)));
  assert.equal(events.at(-1).type, 'issue_marker');
  assert.equal(events.at(-1).payload.category, 'scroll_jump');
  assert.equal(events.at(-1).route, 'home');
});

test('an unfinished local session is recovered with continuous sequence ordering', async () => {
  const storage = createMemoryDiagnosticStorage();
  const localStorage = localStore();
  const first = createDiagnostics({ storage, localStorage, initialEnabled: true });
  await first.initialize();
  first.event('paint_complete');
  await first.flush();
  const id = first.snapshot().id;
  const second = createDiagnostics({ storage, localStorage, initialEnabled: true });
  await second.initialize();
  assert.equal(second.snapshot().id, id);
  const events = await second.events();
  assert.equal(events.at(-1).type, 'diagnostics_session_resumed');
  assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
});

test('payload sanitizer removes credentials, personal prose, signed URL values and JWTs', () => {
  const clean = sanitizeDiagnosticPayload({
    access_token: 'secret', quote_text: 'private quote', review: 'private review',
    message: 'Bearer abc.def.ghi failed for reader@example.test at https://example.test/x?token=secret', safe: 'kept'
  });
  assert.equal(clean.access_token, '[REDACTED]');
  assert.equal(clean.quote_text, '[REDACTED]');
  assert.equal(clean.review, '[REDACTED]');
  assert.doesNotMatch(clean.message, /secret|abc\.def\.ghi|reader@example\.test/);
  assert.equal(clean.safe, 'kept');
});

test('event cap drops repetitive events while preserving limit, errors and issue markers', async () => {
  const recorder = createDiagnostics({ storage: createMemoryDiagnosticStorage(), localStorage: localStore(), initialEnabled: true, maxEvents: 3 });
  await recorder.initialize();
  recorder.event('cover_markup_created');
  recorder.event('cover_markup_created');
  recorder.event('cover_markup_created');
  recorder.event('window_error', { message: 'safe failure' });
  await recorder.markIssue('covers_flashed');
  const types = (await recorder.events()).map(event => event.type);
  assert.ok(types.includes('diagnostics_event_limit_reached'));
  assert.ok(types.includes('window_error'));
  assert.ok(types.includes('issue_marker'));
});

function fakeSupabase() {
  const tables = { diagnostic_sessions: new Map(), diagnostic_events: new Map() };
  const batches = [];
  return {
    tables, batches,
    from(table) {
      return {
        async upsert(value) {
          if (table === 'diagnostic_events') batches.push(Array.isArray(value) ? value.length : 1);
          for (const row of Array.isArray(value) ? value : [value]) {
            const key = table === 'diagnostic_events' ? `${row.session_id}:${row.sequence}` : row.id;
            tables[table].set(key, structuredClone(row));
          }
          return { error: null };
        },
        select() {
          return { eq(_column, sessionId) { return Promise.resolve({ error: null, count: [...tables.diagnostic_events.values()].filter(row => row.session_id === sessionId).length }); } };
        }
      };
    }
  };
}

test('Supabase uploader batches at 250 and remains idempotent by session and sequence', async () => {
  const client = fakeSupabase();
  const uploader = createSupabaseDiagnosticUploader(client);
  const session = { id: crypto.randomUUID(), user_id: crypto.randomUUID(), session_code: 'ABC234', started_at: new Date().toISOString(), ended_at: new Date().toISOString(), app_generation: '46', event_count: 501, issue_count: 0 };
  const events = Array.from({ length: 501 }, (_, index) => ({ session_id: session.id, sequence: index + 1, timestamp_wall: new Date().toISOString(), timestamp_monotonic: index + 1, type: 'paint_complete', route: 'home', book_id: null, visibility_state: 'visible', payload: {} }));
  await uploader.upload(session, events);
  await uploader.upload(session, events);
  assert.equal(client.tables.diagnostic_sessions.size, 1);
  assert.equal(client.tables.diagnostic_events.size, 501);
  assert.deepEqual(client.batches, [250, 250, 1, 250, 250, 1]);
});
