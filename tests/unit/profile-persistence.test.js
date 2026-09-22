import test from 'node:test';
import assert from 'node:assert/strict';
import { updateReaderProfile } from '../../src/data/library.js';

test('profile persistence upserts the authenticated reader profile and returns the saved row', async () => {
  const calls = {};
  const saved = { display_name: 'Calum', handle: '@calum', short_bio: 'Reader', avatar_path: null, updated_at: '2026-09-20' };
  const query = {
    upsert(payload, options) { calls.payload = payload; calls.options = options; return this; },
    select(fields) { calls.fields = fields; return this; },
    async single() { return { data: saved, error: null }; }
  };
  const client = {
    auth: { async getUser() { return { data: { user: { id: 'reader-1' } } }; } },
    from(table) { calls.table = table; return query; }
  };

  assert.equal(await updateReaderProfile({ displayName: ' Calum ', handle: ' @calum ', shortBio: ' Reader ' }, client), saved);
  assert.equal(calls.table, 'reader_profiles');
  assert.deepEqual(calls.payload, { user_id: 'reader-1', display_name: 'Calum', handle: '@calum', short_bio: 'Reader' });
  assert.deepEqual(calls.options, { onConflict: 'user_id' });
  assert.match(calls.fields, /display_name,handle,short_bio,avatar_path,updated_at/);
});
