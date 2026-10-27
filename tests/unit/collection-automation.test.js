import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {discoveryDb,finish} from '../helpers/collection-discovery-db.js';
import {owner,other,bookId} from '../helpers/planner-db.js';
import {registry} from '../../supabase/functions/_shared/collection-registry.js';
import {discoverCollections,discoverWithProviders} from '../../supabase/functions/_shared/collection-discovery.js';
import {buildCollections,overviewCollections,seriesCollectionRoutes,collectionMemberships} from '../../src/features/collections.js';

const cases=[['expanse','Leviathan Wakes','James S. A. Corey',10],['rama','Rendezvous with Rama','Arthur C. Clarke',4],['ready-player','Ready Player One','Ernest Cline',2],['sand','Sand','Hugh Howey',2],['children-of-time','Children of Time','Adrian Tchaikovsky',4],['hitchhikers',"The Hitchhiker's Guide to the Galaxy",'Douglas Adams',6],['thursday-murder-club','The Thursday Murder Club','Richard Osman',5],['beacon-23','Beacon 23','Hugh Howey',1]];
test('every previously singleton core series imports its complete scoped sequence, reuses legacy IDs and preserves serialized metadata',async()=>{
 const books=cases.map((c,i)=>({id:bookId(i+1),title:c[1],authors:c[2],editions:[],original_publication_year:2000}));
 const snapshot={books,series:cases.map((c,i)=>({id:bookId(i+81),name:c[0]==='hitchhikers'?'The Hitchhikers Guide to the Galaxy':registry.collections.find(x=>x.key===c[0]).name})),book_series:cases.map((c,i)=>({book_id:books[i].id,series_id:bookId(i+81),series_order:null}))};
 const db=await discoveryDb(snapshot);
 try {
  for(const b of books) {const j=(await db.query('select * from public.claim_collection_discovery(1,$1)',[b.id])).rows[0];assert.equal(await finish(db,j,discoverCollections(b,snapshot,registry)),true);}
  const rows=async table=>(await db.query(`select * from public.${table}`)).rows;
  const collections=await rows('collections'),works=await rows('collection_catalogue_books'),memberships=await rows('collection_memberships');
  const state={books:books.map(b=>({...b,ownership_status:'Owned',overall_status:'Read'})),collectionData:{collections,works,memberships,books,series:await rows('series'),bookSeries:await rows('book_series'),authorCollections:[]}};
  const built=buildCollections(state);
  for(const [i,c] of cases.entries()) {
   const collection=built.find(x=>x.series_id===snapshot.series[i].id);assert.ok(collection,c[0]);assert.equal(collection.total,c[3],c[0]);assert.equal(collection.owned,1);assert.equal(collection.read,1);
   assert.ok(collection.works.every(w=>Number.isInteger(w.publication_year)));assert.equal(collection.complete,true);
   assert.equal(collectionMemberships(state,books[i]).length,c[0]==='beacon-23'?0:1);
   if(c[0]!=='beacon-23') assert.equal(seriesCollectionRoutes(state)[snapshot.series[i].id].collectionKey,collection.key);
  }
  assert.equal(overviewCollections(state).some(c=>c.name==='Beacon 23'),false);
  assert.equal(collections.filter(c=>c.name==='Beacon 23').length,1);assert.equal(works.filter(w=>w.title==='Beacon 23').length,1);
  assert.equal((await rows('books')).length,8);assert.equal((await rows('book_series')).length,8);assert.equal((await rows('series')).length,12); // eight originals + four seeded official series
  const hitch=built.find(c=>c.name==='Hitchhiker\'s Guide');assert.deepEqual(hitch.works.map(w=>Number(w.official_number)),[1,2,3,4,5,6]);
  assert.equal(hitch.works[5].authors,'Eoin Colfer');assert.equal(hitch.works[5].publication_year,2009);
 }finally{await db.close();}
});

test('migration never activates discovery; source verification and registry revisions reprocess unresolved cases without resetting retry deadlines',async()=>{
 const b={id:bookId(1),title:'Unfamiliar First',authors:'An Author',editions:[]},s={books:[b],series:[],book_series:[]};
 const db=await discoveryDb(s);
 try {
  assert.equal((await db.query("select * from cron.job where jobname like 'collection-discovery%'")).rows.length,0);
  await assert.rejects(db.exec("insert into public.collection_source_catalogues(key,source_url,status,catalogue,verified_at) values('bad','https://quarto.com','verified','{}',now())"),/check constraint/);
  const activation=await readFile('supabase/operations/activate-collection-discovery.sql','utf8');
  await assert.rejects(db.exec(activation),/recent smoke test/);await db.exec('rollback');
  await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);await db.query('update private.app_state set owner_user_id=$1',[owner]);
  await db.query('select public.refresh_collection_registry($1)',[registry.revision]);
  let j=(await db.query('select * from public.claim_collection_discovery(1)')).rows[0];await finish(db,j,discoverCollections(b,s,registry));
  const c={works:[{key:'unknown:1',title:b.title,authors:b.authors,source_url:'https://quarto.com/series',verified_at:'2026-10-26'},{key:'unknown:2',title:'Unfamiliar Second',authors:b.authors,source_url:'https://quarto.com/series',verified_at:'2026-10-26'}],collections:[{key:'unknown-series',name:'Newly Verified Series',kind:'series',complete:true,source_url:'https://quarto.com/series',verified_at:'2026-10-26',members:[{work_key:'unknown:1',official_number:1},{work_key:'unknown:2',official_number:2}]}]};
  await db.query("insert into public.collection_source_catalogues(key,source_url,status,catalogue) values('new','https://quarto.com/series','candidate',$1)",[JSON.stringify(c)]);
  assert.equal((await db.query('select status from public.collection_discovery_jobs')).rows[0].status,'unresolved');
  await db.exec("update public.collection_source_catalogues set status='verified',verified_at=now()");
  assert.equal((await db.query('select status from public.collection_discovery_jobs')).rows[0].status,'queued');
  j=(await db.query('select * from public.claim_collection_discovery(1)')).rows[0];
  const d=await discoverWithProviders(b,{...s,sources:(await db.query('select * from public.collection_source_catalogues')).rows},registry);assert.equal(d.status,'linked');await finish(db,j,d);
  await db.exec('update public.collection_source_catalogues set updated_at=now()');assert.equal((await db.query('select status from public.collection_discovery_jobs')).rows[0].status,'completed');
  assert.equal((await db.query('select public.refresh_collection_registry($1) n',[registry.revision])).rows[0].n,0);
  // Completed/complete series must also learn later published releases.
  assert.equal((await db.query('select public.refresh_collection_registry($1) n',['release-version-hash'])).rows[0].n,1);
  j=(await db.query('select * from public.claim_collection_discovery(1)')).rows[0];await finish(db,j,d);
  await db.exec("update public.collection_discovery_jobs set status='unresolved'");
  assert.equal((await db.query('select public.refresh_collection_registry($1) n',['release-version-hash'])).rows[0].n,0);
  assert.equal((await db.query('select public.refresh_collection_registry($1) n',['new-version-hash'])).rows[0].n,1);
  j=(await db.query('select * from public.claim_collection_discovery(1)')).rows[0];await finish(db,j,{},'429','2099-01-01');
  assert.equal((await db.query('select public.refresh_collection_registry($1) n',['next-version-hash'])).rows[0].n,0);
  assert.equal((await db.query('select status from public.collection_discovery_jobs')).rows[0].status,'retry');
  assert.equal((await db.query('select * from public.claim_collection_discovery(1)')).rows.length,0);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
  assert.equal((await db.query('select * from public.collection_source_catalogues')).rows.length,1);
  for(const sql of ['update public.collection_source_catalogues set status=\'verified\'','select public.refresh_collection_registry(\'new-version-hash\')','select * from public.collection_worker_smoke']) await assert.rejects(db.exec(sql),/permission denied/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);assert.equal((await db.query('select * from public.collection_source_catalogues')).rows.length,0);
  await db.exec('reset role;set role anon');await assert.rejects(db.exec('select * from public.collection_source_catalogues'),/permission denied/);await db.exec('reset role');
  await db.query("insert into public.collection_worker_smoke(worker_revision,book_id) values('tested-worker',$1)",[b.id]);
  await db.exec("select set_config('readingroom.approved_collection_worker_revision','wrong-worker',false)");await assert.rejects(db.exec(activation),/recent smoke test/);await db.exec('rollback');
  await db.exec("select set_config('readingroom.approved_collection_worker_revision','tested-worker',false)");await db.exec(activation);
  assert.equal((await db.query("select * from cron.job where jobname like 'collection-discovery%'")).rows.length,1);
 }finally{await db.close();}
});
