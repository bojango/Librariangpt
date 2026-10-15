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
  assert.match(calls.fields, /display_name,handle,library_name,short_bio,avatar_path,updated_at/);
});

test('library name persists with entered casing; legacy identity saves do not clear it',async()=>{
  const payloads=[];
  const saved={display_name:'Calum',handle:'Calum Lewis',library_name:'Alder Creek Library'};
  const query={upsert(payload){payloads.push(payload);return this;},select(){return this;},async single(){return {data:saved};}};
  const client={auth:{async getUser(){return {data:{user:{id:'owner'}}};}},from(){return query;}};
  assert.equal(await updateReaderProfile({displayName:'Calum',handle:'Calum Lewis',libraryName:' Alder Creek Library '},client),saved);
  assert.equal(payloads[0].library_name,'Alder Creek Library');
  await updateReaderProfile({displayName:'Calum',handle:'Calum Lewis'},client);
  assert.equal(Object.hasOwn(payloads[1],'library_name'),false);
  await updateReaderProfile({displayName:'Calum',handle:'Calum Lewis',libraryName:''},client);
  assert.equal(payloads[2].library_name,null);
  await assert.rejects(updateReaderProfile({displayName:'Calum',handle:'Calum Lewis',libraryName:'a'.repeat(121)},client),/120 characters/);
});
