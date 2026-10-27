import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {plannerDb,owner,other,bookId} from '../helpers/planner-db.js';
const migration='supabase/migrations/20261020205229_collections_reading_paths.sql';
async function database() {
 const db=await plannerDb();
 await db.exec(await readFile(migration,'utf8'));
 await db.exec(await readFile('supabase/seeds/collections-verified.sql','utf8'));
 return db;
}
async function save(db,key,entries) {return (await db.query('select public.save_reading_path($1,$2::jsonb) id',[key,JSON.stringify(entries)])).rows[0].id;}

test('migration and verified seed execute without creating Library or recommendation rows',async()=>{
 const db=await database();
 try {
  assert.equal((await db.query('select count(*)::int n from public.collection_catalogue_books')).rows[0].n,36);
  assert.equal((await db.query('select count(*)::int n from public.collections')).rows[0].n,6);
  for(const table of ['library_entries','recommendations','reading_paths']) assert.equal((await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from public.book_series")).rows[0].n,0);
 } finally {await db.close();}
});
test('owner can save cross-series order and replace it atomically; invalid or duplicate entries preserve the saved path',async()=>{
 const db=await database();
 try {
  await db.exec('set role authenticated');
  const id=await save(db,'nora-corrie',[{work_key:'pc:whitefire',selection:'recommended',reasoning:'Existing reason'},{work_key:'pc:old-bones',selection:'optional'},{work_key:'pc:thunderhead',selection:'skipped'}]);
  assert.deepEqual((await db.query('select work_key,position,selection from public.reading_path_entries order by position')).rows,[{work_key:'pc:whitefire',position:1,selection:'recommended'},{work_key:'pc:old-bones',position:2,selection:'optional'},{work_key:'pc:thunderhead',position:3,selection:'skipped'}]);
  await assert.rejects(save(db,'nora-corrie',[{work_key:'missing',selection:'recommended'}]));
  await assert.rejects(save(db,'nora-corrie',[{work_key:'pc:relic',selection:'invalid'}]));
  await assert.rejects(save(db,'nora-corrie',[{work_key:'pc:relic',selection:'optional'},{work_key:'pc:relic',selection:'skipped'}]));
  assert.equal((await db.query('select count(*)::int n from public.reading_path_entries')).rows[0].n,3);
  assert.equal(await save(db,'nora-corrie',[]),id);
  assert.equal((await db.query('select count(*)::int n from public.reading_path_entries')).rows[0].n,0);
 } finally {await db.close();}
});
test('RLS blocks non-owner reads, writes, RPCs, catalogue mutation and ownership reassignment; anonymous has no privileges',async()=>{
 const db=await database();
 try {
  await db.exec('set role authenticated');
  const id=await save(db,'silo',[{work_key:'howey:wool',selection:'recommended'}]);
  await assert.rejects(db.query('update public.reading_paths set user_id=$1 where id=$2',[other,id]));
  await assert.rejects(db.query('update public.reading_path_entries set user_id=$1 where path_id=$2',[other,id]));
  await assert.rejects(db.exec("update public.collections set name='Changed'"));
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  for(const table of ['reading_paths','reading_path_entries','collections','collection_memberships','collection_catalogue_books']) assert.equal((await db.query(`select * from public.${table}`)).rows.length,0);
  await assert.rejects(save(db,'silo',[]),/Not authorized/);
  await assert.rejects(db.query('insert into public.reading_path_entries(path_id,user_id,work_key,position,selection) values($1,$2,$3,1,$4)',[id,other,'howey:dust','optional']));
  await db.exec('reset role;set role anon');
  await assert.rejects(db.exec('select * from public.collections'));
  await assert.rejects(save(db,'silo',[]));
 } finally {await db.close();}
});
test('seed links exact canonical identities and reuses series membership without touching edition or reader data',async()=>{
 const db=await plannerDb();
 try {
  await db.query("insert into public.books(id,title,original_publication_year) values($1,'Jurassic Park',1990)",[bookId(1)]);
  await db.exec("insert into public.authors(name) values('Michael Crichton');");
  await db.query("insert into public.book_authors(book_id,author_id,author_order) select $1,id,1 from public.authors where name='Michael Crichton'",[bookId(1)]);
  await db.exec(await readFile(migration,'utf8'));await db.exec(await readFile('supabase/seeds/collections-verified.sql','utf8'));
  assert.equal((await db.query("select book_id from public.collection_catalogue_books where key='crichton:jurassic-park'")).rows[0].book_id,bookId(1));
  assert.equal((await db.query('select series_order from public.book_series where book_id=$1',[bookId(1)])).rows[0].series_order,'1.00');
 } finally {await db.close();}
});
