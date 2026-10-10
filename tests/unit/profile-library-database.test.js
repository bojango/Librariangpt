import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { plannerDb,owner,other } from '../helpers/planner-db.js';

const migration='supabase/migrations/20261010163448_profile_library_name.sql';
test('library-name migration seeds only the owner, retains identity and keeps owner RLS/no global default',async t=>{
  const db=await plannerDb();t.after(()=>db.close());
  const original=await readFile('supabase/migrations/20260919120000_add_private_reader_profiles.sql','utf8');
  // Run the actual profile schema/policies; Storage is a separate platform service.
  await db.exec(original.split('insert into storage.buckets')[0]);
  await db.query("insert into public.reader_profiles(user_id,display_name,handle,short_bio,avatar_path) values($1,'Calum','Calum Lewis','Existing bio','owner/avatar.png'),($2,'Other','Other identity',null,null)",[owner,other]);
  await db.exec(await readFile(migration,'utf8'));
  const profile=(await db.query('select * from reader_profiles where user_id=$1',[owner])).rows[0];
  assert.equal(profile.library_name,'Alder Creek Library');assert.equal(profile.handle,'Calum Lewis');assert.equal(profile.short_bio,'Existing bio');assert.equal(profile.avatar_path,'owner/avatar.png');
  assert.equal((await db.query('select library_name from reader_profiles where user_id=$1',[other])).rows[0].library_name,null);
  assert.equal((await db.query("select column_default from information_schema.columns where table_name='reader_profiles' and column_name='library_name'")).rows[0].column_default,null);
  await db.exec('set role authenticated');
  await db.query('update reader_profiles set library_name=$1 where user_id=$2',["Calum's quiet library",owner]);
  assert.equal((await db.query('select library_name from reader_profiles')).rows[0].library_name,"Calum's quiet library");
  assert.equal((await db.query('update reader_profiles set library_name=$1 where user_id=$2 returning user_id',['Forbidden',other])).rows.length,0);
  await db.exec(`reset role; select set_config('request.jwt.claim.sub','${other}',false); set role authenticated`);
  assert.equal((await db.query('select * from reader_profiles')).rows.length,0);
  await assert.rejects(db.query('insert into reader_profiles(user_id,library_name) values($1,$2)',[other,'Forbidden']),/row-level security/);
  await db.exec('reset role; set role anon');await assert.rejects(db.query('select library_name from reader_profiles'),/permission denied/);
  await db.exec('reset role');
  await db.exec(await readFile('tests/sql/profile-library-live.sql','utf8'));
  assert.equal((await db.query('select library_name from reader_profiles where user_id=$1',[owner])).rows[0].library_name,"Calum's quiet library");
});
