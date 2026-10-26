import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {discoverCollections,discoverWithProviders,matchWork} from '../../supabase/functions/_shared/collection-discovery.js';
import {registry} from '../../supabase/functions/_shared/collection-registry.js';
import {discoveryDb,finish} from '../helpers/collection-discovery-db.js';
import {owner,other,bookId} from '../helpers/planner-db.js';

const book=(n,title,authors)=>({id:bookId(n),title,authors,editions:[]});
const books=[book(1,'Gateway','Frederik Pohl'),book(2,'Revelation Space','Alastair Reynolds'),book(3,'Pushing Ice','Alastair Reynolds'),book(4,'We Are Legion (We Are Bob)','Dennis E. Taylor'),book(5,'Leviathan Wakes','James S. A. Corey'),book(6,'Thunderhead','Douglas Preston, Lincoln Child'),book(7,'Host','Russ Capasso')];
const snapshot={books,series:[],book_series:[]};

test('all canonical works are classified, including Gateway, universes, standalones and unresolved',()=>{
  const outcomes=books.map(b=>discoverCollections(b,snapshot,registry));
  assert.deepEqual(outcomes.map(d=>d.status),['linked','linked','standalone','linked','linked','linked','unresolved']);
  assert.equal(outcomes[0].collections[0].complete,false);
  assert.ok(outcomes[1].collections.some(c=>c.kind==='universe'));
  assert.ok(outcomes[1].collections.some(c=>c.key==='inhibitor-trilogy'));
  assert.equal(outcomes[3].works.length,6);
  assert.equal(outcomes[4].works.length,9);
  assert.ok(outcomes[5].collections.some(c=>c.key==='nora-corrie'));
  assert.ok(outcomes[5].collections.some(c=>c.key==='preston-child'));
});
test('title collisions, duplicate canonical works, different authors and conflicting work IDs stay unresolved',()=>{
  const b=books[0],w={key:'g',title:b.title,authors:b.authors,identifiers:['ol:OL1W']};
  assert.equal(matchWork({...b,authors:'Another Author'},[w]).work,undefined);
  assert.equal(matchWork(b,[w],[b,{...b,id:bookId(99)}]).work,undefined);
  assert.equal(matchWork({...b,editions:[{open_library_work_id:'OL2W'}]},[w]).work,undefined);
  const editionAlias={...b,title:'Source-backed alias',editions:[{open_library_work_id:'OL1W'}]};
  assert.equal(matchWork(editionAlias,[w]).basis,'stable_identifier_and_author');
  assert.equal(matchWork({...b,authors:''},[w]).work,undefined);
});
test('provider evidence is reused, hints never fabricate memberships, and absence never verifies standalone',async()=>{
  let calls=0;
  const cached={...books[6],editions:[{open_library_work_id:'OL1W',metadata_payload:{open_library_work:{series:['Unverified Series']}}}]};
  const result=await discoverWithProviders(cached,{...snapshot,books:[cached]},registry,{fetchJson:async()=>{calls++;return {};}});
  assert.equal(calls,0);assert.equal(result.status,'unresolved');assert.equal(result.candidates[0].verified,false);
  const fresh={...cached,editions:[{open_library_work_id:'OL1W'}]};
  const empty=await discoverWithProviders(fresh,{...snapshot,books:[fresh]},registry,{fetchJson:async url=>{calls++;assert.equal(url,'https://openlibrary.org/works/OL1W.json');return {};}});
  assert.equal(calls,1);assert.equal(empty.status,'unresolved');assert.deepEqual(empty.collections,[]);
  await assert.rejects(discoverWithProviders(fresh,{...snapshot,books:[fresh]},registry,{fetchJson:async()=>{throw new Error('HTTP 429');}}),/429/);
});
test('registry has unique works, sources, explicit scopes and no invented universe positions',()=>{
  assert.equal(new Set(registry.works.map(w=>w.key)).size,registry.works.length);
  for(const c of registry.collections) {
    assert.match(c.source_url,/^https:\/\//);assert.ok(c.description);
    for(const m of c.members) assert.ok(registry.works.some(w=>w.key===m.work_key));
    if(c.kind!=='series') assert.ok(c.members.every(m=>m.official_number===null));
  }
  const sixth=registry.works.find(w=>w.key==='bobiverse:the-infinite-extent');
  assert.equal(sixth.publication_year,2026);assert.notEqual(sixth.publication_state,'forthcoming');
});

test('real PostgreSQL migration, queue, atomic import, idempotency, reader preservation and permissions',async t=>{
 const db=await discoveryDb(snapshot);
 try {
  await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
  await db.query('update private.app_state set owner_user_id=$1',[owner]);
  await db.query("insert into public.library_entries(user_id,book_id,overall_status,ownership_status,user_review) values($1,$2,'Read','Owned','Keep review')",[owner,books[0].id]);
  await db.query("insert into public.recommendations(user_id,book_id,recommendation_status,why_recommended) values($1,$2,'Acquired','Keep history')",[owner,books[0].id]);
  await db.query("with p as (insert into public.reading_paths(user_id,collection_key) values($1,'silo') returning id) insert into public.reading_path_entries(path_id,user_id,work_key,position,selection,reasoning) select id,$1,'howey:wool',1,'skipped','Keep my personalised path' from p",[owner]);
  const protectedData=async()=>JSON.stringify((await db.query(`select jsonb_build_object('books',(select jsonb_agg(b order by id) from public.books b),'editions',(select jsonb_agg(e order by id) from public.editions e),'library',(select jsonb_agg(l order by id) from public.library_entries l),'recommendations',(select jsonb_agg(r order by id) from public.recommendations r),'paths',(select jsonb_agg(p order by id) from public.reading_paths p),'entries',(select jsonb_agg(e order by path_id,position) from public.reading_path_entries e)) data`)).rows[0].data);
  const before=await protectedData();
  await t.test('migration enqueues every book outside Library; claim is exclusive',async()=>{
    assert.equal((await db.query('select count(*)::int n from public.collection_discovery_jobs')).rows[0].n,books.length);
    const jobs=(await db.query('select * from public.claim_collection_discovery(4)')).rows;
    const next=(await db.query('select * from public.claim_collection_discovery(4)')).rows;
    assert.equal(new Set([...jobs,...next].map(j=>j.book_id)).size,books.length);
    for(const j of [...jobs,...next]) assert.equal(await finish(db,j,discoverCollections(books.find(b=>b.id===j.book_id),snapshot,registry)),true);
    assert.equal(await protectedData(),before);
  });
  await t.test('catalogue-only works never become Library, canonical books or editions',async()=>{
    assert.equal((await db.query('select count(*)::int n from public.books')).rows[0].n,books.length);
    assert.equal((await db.query('select count(*)::int n from public.library_entries')).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from public.collection_memberships m join public.collections c on c.key=m.collection_key where c.name='Bobiverse'")).rows[0].n,6);
  });
  await t.test('repeat reconciliation and complete replay preserve bibliographic and reader rows',async()=>{
    const catalogue=async()=>JSON.stringify((await db.query(`select jsonb_build_object('c',(select jsonb_agg(c order by key) from public.collections c),'w',(select jsonb_agg(w order by key) from public.collection_catalogue_books w),'m',(select jsonb_agg(m order by collection_key,work_key) from public.collection_memberships m)) data`)).rows[0].data);
    const once=await catalogue();
    await db.exec('select public.reconcile_collection_discovery();select public.reconcile_collection_discovery()');
    await db.exec("update public.collection_discovery_jobs set status='queued',attempt_count=0");
    for(;;) {
      const jobs=(await db.query('select * from public.claim_collection_discovery(4)')).rows;if(!jobs.length) break;
      for(const j of jobs) await finish(db,j,discoverCollections(books.find(b=>b.id===j.book_id),snapshot,registry));
    }
    assert.equal(await catalogue(),once);assert.equal(await protectedData(),before);
  });
  await t.test('edition identity changes invalidate a claim even after normal metadata completion',async()=>{
    await db.query("update public.collection_discovery_jobs set status='queued',attempt_count=0 where book_id=$1",[books[0].id]);
    const job=(await db.query('select * from public.claim_collection_discovery(1,$1)',[books[0].id])).rows[0];
    await db.query('insert into public.editions(book_id,isbn13) values($1,$2)',[books[0].id,'9780306406157']);
    assert.equal(await finish(db,job,discoverCollections(books[0],snapshot,registry)),false);
    const current=(await db.query('select * from public.collection_discovery_jobs where book_id=$1',[books[0].id])).rows[0];
    assert.equal(current.status,'queued');assert.ok(current.revision>job.revision);
    const refreshed=(await db.query('select * from public.claim_collection_discovery(1,$1)',[books[0].id])).rows[0];
    await finish(db,refreshed,discoverCollections(books[0],snapshot,registry));
    await db.query("update public.books set metadata_status='resolved' where id=$1",[books[0].id]);
    await db.query("update public.editions set open_library_work_id='OL60924W',metadata_payload=$2 where book_id=$1",[books[0].id,JSON.stringify({open_library:{works:[{key:'/works/OL60924W'}]}})]);
    assert.equal((await db.query('select status from public.collection_discovery_jobs where book_id=$1',[books[0].id])).rows[0].status,'queued');
    assert.equal((await db.query('select metadata_status from public.books where id=$1',[books[0].id])).rows[0].metadata_status,'resolved');
    const revision=(await db.query('select revision from public.collection_discovery_jobs where book_id=$1',[books[0].id])).rows[0].revision;
    await db.query("insert into public.book_external_ids(book_id,provider,external_id) values($1,'Open Library','OL60924W')",[books[0].id]);
    assert.ok((await db.query('select revision from public.collection_discovery_jobs where book_id=$1',[books[0].id])).rows[0].revision>revision);
  });
  await t.test('bounded retries respect provider deadlines and recover abandoned leases without stale writes',async()=>{
    const id=books[6].id;
    await db.query("update public.collection_discovery_jobs set status='queued',attempt_count=0 where book_id=$1",[id]);
    const job=(await db.query('select * from public.claim_collection_discovery(1,$1)',[id])).rows[0];
    const deadline='2099-01-01T00:00:00Z';await finish(db,job,{},'HTTP 429',deadline);
    assert.equal((await db.query('select error from public.collection_discovery_attempts where claim_token=$1',[job.claim_token])).rows[0].error,'HTTP 429');
    assert.equal((await db.query('select * from public.claim_collection_discovery(1,$1)',[id])).rows.length,0);
    assert.equal(Date.parse((await db.query('select available_at from public.collection_discovery_jobs where book_id=$1',[id])).rows[0].available_at),Date.parse(deadline));
    await db.query("update public.collection_discovery_jobs set status='processing',locked_at=now()-interval '16 minutes',attempt_count=4 where book_id=$1",[id]);
    const recovered=(await db.query('select * from public.claim_collection_discovery(1,$1)',[id])).rows[0];
    assert.notEqual(recovered.claim_token,job.claim_token);assert.equal(recovered.attempt_count,5);
    assert.equal(await finish(db,job,{}),false);await finish(db,recovered,{},'HTTP 503');
    assert.equal((await db.query('select status from public.collection_discovery_jobs where book_id=$1',[id])).rows[0].status,'failed');
    assert.equal((await db.query('select count(*)::int n from public.collection_discovery_attempts where book_id=$1 and error is not null',[id])).rows[0].n,2);
  });
  await t.test('owner scoped RLS and service-only worker functions reject other owners and anonymous callers',async()=>{
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);await db.exec('set role authenticated');
    assert.equal((await db.query('select * from public.collection_discovery_jobs')).rows.length,books.length);
    assert.ok((await db.query('select * from public.collection_discovery_attempts')).rows.length>0);
    await assert.rejects(db.exec('select public.claim_collection_discovery()'),/permission denied/);
    await assert.rejects(db.exec('delete from public.collection_discovery_jobs'),/permission denied/);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
    assert.equal((await db.query('select * from public.collection_discovery_jobs')).rows.length,0);
    assert.equal((await db.query('select * from public.collection_discovery_attempts')).rows.length,0);
    await db.exec('reset role;set role anon');await assert.rejects(db.exec('select * from public.collection_discovery_jobs'),/permission denied/);
    await db.exec('reset role;set role service_role');assert.equal((await db.query('select public.reconcile_collection_discovery() n')).rows[0].n,0);
    await db.exec('reset role');
  });
 } finally {await db.close();}
});

test('legacy canonical IDs and valid numbering survive while missing positions fill and conflicting evidence is reported',async()=>{
 const s1=bookId(81),s2=bookId(82),local={books:[books[0],books[3]],series:[{id:s1,name:'Heechee'},{id:s2,name:'Bobiverse'}],book_series:[{book_id:books[0].id,series_id:s1,series_order:2},{book_id:books[3].id,series_id:s2,series_order:null}]};
 const db=await discoveryDb(local);
 try {
  const claims=(await db.query('select * from public.claim_collection_discovery(4)')).rows;
  for(const job of claims) await finish(db,job,discoverCollections(local.books.find(b=>b.id===job.book_id),local,registry));
  assert.equal(Number((await db.query('select series_order from public.book_series where book_id=$1',[books[0].id])).rows[0].series_order),2);
  assert.equal((await db.query('select status from public.collection_discovery_jobs where book_id=$1',[books[0].id])).rows[0].status,'unresolved');
  assert.equal(Number((await db.query('select series_order from public.book_series where book_id=$1',[books[3].id])).rows[0].series_order),1);
  assert.equal((await db.query('select key from public.collections where series_id=$1',[s2])).rows[0].key,`series:${s2}`);
  assert.equal((await db.query('select count(*)::int n from public.series')).rows[0].n,6); // four starter series + the two original series
 } finally {await db.close();}
});

test('similarly named series by another author stay separate and invalid imports roll back atomically',async()=>{
 const unrelated=book(50,'Other Gateway','Different Author'),beyond=book(51,'Beyond the Blue Event Horizon','Frederik Pohl'),sid=bookId(80),local={books:[books[0],unrelated,beyond],series:[{id:sid,name:'Heechee'}],book_series:[{book_id:unrelated.id,series_id:sid,series_order:1}]};
 const db=await discoveryDb(local);
 try {
  const job=(await db.query('select * from public.claim_collection_discovery(1,$1)',[books[0].id])).rows[0];
  const decision=discoverCollections(books[0],local,registry),bad=structuredClone(decision);
  bad.collections[0].members[0].official_number='not-a-number';
  const before=(await db.query('select count(*)::int n from public.collection_catalogue_books')).rows[0].n;
  await assert.rejects(finish(db,job,bad));
  assert.equal((await db.query('select count(*)::int n from public.collection_catalogue_books')).rows[0].n,before);
  await db.query("update public.books set title='Changed identity' where id=$1",[beyond.id]);
  await assert.rejects(finish(db,job,decision),/Canonical identity changed/);
  assert.equal((await db.query('select count(*)::int n from public.collection_catalogue_books')).rows[0].n,before);
  await db.query('update public.books set title=$2 where id=$1',[beyond.id,beyond.title]);
  assert.equal(await finish(db,job,decision),true);
  const collection=(await db.query("select * from public.collections where key='heechee'")).rows[0];
  assert.notEqual(collection.series_id,sid);assert.equal(collection.name,'Heechee');
  assert.equal((await db.query('select count(*)::int n from public.book_series where series_id=$1',[sid])).rows[0].n,1);
  assert.equal((await db.query('select status from public.collection_discovery_jobs where book_id=$1',[books[0].id])).rows[0].status,'completed');
 } finally {await db.close();}
});
