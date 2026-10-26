import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {discoveryDb} from '../helpers/collection-discovery-db.js';
import {owner,other,bookId} from '../helpers/planner-db.js';
import {enrichCatalogueWork,verifiedCover,googleCandidate,publisherCandidate,publisherBookLink} from '../../supabase/functions/_shared/catalogue-enrichment.js';
import {edgeHandler,memoryAdmin} from '../helpers/enrichment-edge.js';
import {assessmentBadge,assessmentReason} from '../../src/views/collections.js';
import {buildCollections} from '../../src/features/collections.js';
const migration='supabase/migrations/20261026210308_catalogue_enrichment_assessments.sql';
async function setup(){
 const db=await discoveryDb();
 await db.exec(await readFile('supabase/migrations/20260908080146_ai_recommendation_shelf.sql','utf8'));
 await db.query('insert into auth.users(id) values($1),($2)',[owner,other]);
 await db.query('update private.app_state set owner_user_id=$1',[owner]);
 await db.exec(await readFile(migration,'utf8'));
 await db.exec(await readFile('supabase/migrations/20261026212754_catalogue_source_evidence.sql','utf8'));
 return db;
}
const queryRow=async(db,sql,args=[])=> (await db.query(sql,args)).rows[0];
test('additive migration queues all works, isolates roles, leaves Library/recommendations/paths unchanged',async()=>{
 const db=await setup();try{
  const counts=await queryRow(db,'select (select count(*) from collection_catalogue_books)::int works,(select count(*) from catalogue_enrichment_jobs)::int metadata,(select count(*) from collection_assessments)::int assessments,(select count(*) from library_entries)::int library,(select count(*) from recommendations)::int recommendations,(select count(*) from reading_paths)::int paths');
  assert.equal(counts.works,counts.metadata);assert.equal(counts.works,counts.assessments);assert.equal(counts.library+counts.recommendations+counts.paths,0);
  await db.exec(`set role authenticated;set request.jwt.claim.sub='${other}';`);
  assert.equal((await db.query('select * from collection_assessments')).rows.length,0);
  await assert.rejects(db.query('select public.collection_librarian_candidates()'),/permission denied/);
  await assert.rejects(db.query("update collection_assessments set verdict='optional'"),/permission denied/);
  await db.exec(`reset role;set role service_role;`);
  await assert.rejects(db.query('select public.collection_librarian_candidates()'),/permission denied/);
  await db.exec('reset role');
  assert.equal((await db.query("select * from cron.job where jobname like '%catalogue%' or jobname like '%intelligence%'")).rows.length,0);
 }finally{await db.close();}
});
test('new work trigger, fenced claims, metadata preservation and bounded provider retry',async()=>{
 const db=await setup();try{
  await db.exec("insert into collection_catalogue_books(key,title,authors,publication_year,cover_url,source_url,verified_at) values('new','New','Author',2000,'https://example.test/manual.jpg','https://example.test/book',current_date)");
  const job=await queryRow(db,"select * from claim_catalogue_enrichment(1,'new')");assert.equal(job.attempt_count,1);
  assert.equal((await db.query("select * from claim_catalogue_enrichment(1,'new')")).rows.length,0);
  const result={synopsis:'A factual provider description.',publication_year:2020,cover_url:'https://example.test/other.jpg',cover_verified:true,sources:[{source_url:'https://example.test/book',provider:'Publisher'}]};
  assert.equal((await queryRow(db,'select finish_catalogue_enrichment($1,$2,$3,null,null) ok',['new',other,result])).ok,false);
  assert.equal((await queryRow(db,'select finish_catalogue_enrichment($1,$2,$3,null,now()+interval \'2 days\') ok',['new',job.claim_token,result])).ok,true);
  const work=await queryRow(db,"select * from collection_catalogue_books where key='new'");assert.equal(work.cover_url,'https://example.test/manual.jpg');assert.equal(work.publication_year,2000);assert.equal(work.synopsis,result.synopsis);assert.equal(work.cover_verified_at,null);
  assert.ok((await queryRow(db,"select available_at>now()+interval '47 hours' ok from catalogue_enrichment_jobs where work_key='new'")).ok);
  await db.exec("update catalogue_enrichment_jobs set status='processing',locked_at=now()-interval '20 minutes',available_at=now()-interval '1 day',claim_token=gen_random_uuid() where work_key='new'");
  assert.ok((await queryRow(db,"select * from claim_catalogue_enrichment(1,'new')")).claim_token);
  assert.equal((await queryRow(db,"select count(*)::int n from collection_processing_attempts where work_key='new' and outcome='expired'")).n,1);
 }finally{await db.close();}
});
test('individual assessment, duplicate publication fencing, pending failure and canonical association preserve history',async()=>{
 const db=await setup();try{
  const taste=await queryRow(db,"insert into taste_profile(user_id,dimension,preference) values($1,'Story','Exploration and discovery') returning id",[owner]);
  // New context settles once; this is a test clock adjustment, not a production bypass.
  await db.query('select reconcile_collection_intelligence()');await db.exec("update private.collection_taste_versions set candidate_since=now()-interval '7 hours'");
  const response=(await queryRow(db,'select collection_librarian_candidates(1) result')).result,candidate=response.candidates[0],job=candidate.job;
  const assessment={verdict:'not_recommended',appeal:'Its documented expedition premise matches your stated interest in discovery.',frustrations:'The source describes a relationship-led story, while your profile asks for sustained exploration.',reasoning:'The relationship focus reduces the personal fit even though the expedition premise is relevant to your discovery preference.',continuity:'Official position is bibliographic context; it does not establish personal enjoyment.',confidence:'Medium',evidence:[{source_url:candidate.work.source_url,detail:'Fixture source describes the premise and relationship focus.'}],taste_evidence_ids:[taste.id],inference_provenance:'Controlled test assessment; no provider inference'};
  const publish=()=>queryRow(db,'select publish_collection_assessment($1,$2,$3,$4) ok',[job.work_key,job.claim_token,job.taste_version,assessment]);
  assert.equal((await publish()).ok,true);assert.equal((await publish()).ok,false);
  assert.equal((await queryRow(db,'select match_score_10 from collection_assessments where work_key=$1',[job.work_key])).match_score_10,null);
  await db.query('insert into books(id,title) values($1,$2)',[bookId(100),candidate.work.title]);
  await db.query('update collection_catalogue_books set book_id=$1 where key=$2',[bookId(100),job.work_key]);
  await db.query("insert into library_entries(user_id,book_id,overall_status,ownership_status) values($1,$2,'Wishlist','Not Owned')",[owner,bookId(100)]);
  assert.equal((await queryRow(db,'select verdict from collection_assessments where work_key=$1',[job.work_key])).verdict,'not_recommended');
  assert.equal((await queryRow(db,'select count(*)::int n from recommendations')).n,0);
  await db.query('select reconcile_collection_intelligence()');await db.exec("update private.collection_taste_versions set candidate_since=now()-interval '7 hours'");
  await db.query("update collection_assessment_jobs set status='queued',available_at=now()-interval '1 second' where work_key=$1",[job.work_key]);
  const next=(await queryRow(db,'select collection_librarian_candidates(12) result')).result.candidates.find(c=>c.job.work_key===job.work_key);
  assert.ok(next);assert.equal((await queryRow(db,'select publish_collection_assessment($1,$2,$3,$4) ok',[job.work_key,next.job.claim_token,next.job.taste_version,{verdict:'pending',pending_reason:'Provider evidence unavailable; retain prior assessment.'}])).ok,true);
  assert.equal((await queryRow(db,'select verdict from collection_assessments where work_key=$1',[job.work_key])).verdict,'not_recommended');
 }finally{await db.close();}
});
test('material taste hashes ignore cosmetic updates and progress while source edits invalidate claims',async()=>{
 const db=await setup();try{
  await db.query("insert into taste_profile(user_id,dimension,preference) values($1,'Structure','Explore strange worlds')",[owner]);
  const hash=()=>queryRow(db,'select private.collection_taste_hash(private.collection_taste_context($1)) h',[owner]);const before=(await hash()).h;
  await db.exec("update taste_profile set preference='Explore, strange WORLDS!',confidence='High'");assert.equal((await hash()).h,before);
  await db.query('insert into books(id,title) values($1,$2)',[bookId(150),'An unassessed Wishlist work']);
  await db.query("insert into library_entries(user_id,book_id,overall_status,ownership_status) values($1,$2,'Wishlist','Not Owned')",[owner,bookId(150)]);
  assert.equal((await hash()).h,before,'Wishlist additions alone do not trigger paid/repeated inference');
  await db.exec("update taste_profile set preference='Prefer relationship drama'");assert.notEqual((await hash()).h,before);
  await db.query('select reconcile_collection_intelligence()');
  assert.equal((await queryRow(db,'select collection_librarian_candidates(1) result')).result.status,'taste_change_settling');
  const key=(await queryRow(db,'select key from collection_catalogue_books limit 1')).key;
  const content=()=>queryRow(db,'select private.collection_content_version(w) h from collection_catalogue_books w where key=$1',[key]);
  const original=(await content()).h;await db.query("update collection_catalogue_books set metadata_sources=metadata_sources||'[ {\"provider\":\"Covers\",\"source_url\":\"https://cover.test/image\",\"fields\":[\"cover\"]} ]'::jsonb where key=$1",[key]);assert.equal((await content()).h,original);
  const w=await queryRow(db,'select * from collection_catalogue_books where key=$1',[key]);
  await assert.rejects(db.query('select record_catalogue_source_summary($1,$2,$3,$4,$5)',[key,'Wrong work',w.authors,w.source_url,'A factual source summary long enough to give a specific and supported account of this work.']),/identity mismatch/);
  assert.equal((await queryRow(db,'select record_catalogue_source_summary($1,$2,$3,$4,$5) saved',[key,w.title,w.authors,w.source_url,'A factual source summary long enough to give a specific and supported account of this work.'])).saved,true);
  assert.notEqual((await content()).h,original);
 }finally{await db.close();}
});
const work={key:'example',title:'The Voyage',authors:'Jane Author',publication_year:2000,source_url:'https://publisher.test/voyage'};
test('catalogue providers require exact identity, reuse metadata, reject placeholders and preserve provider deadlines',async()=>{
 assert.equal(googleCandidate(work,{id:'x',volumeInfo:{title:work.title,authors:['Wrong Author'],description:'Wrong work'}}),null);
 assert.equal(publisherCandidate(work,'<script type="application/ld+json">'+JSON.stringify({'@type':'Book',name:work.title,author:{name:work.authors},description:'A factual voyage.'})+'</script>',work.source_url).synopsis,'A factual voyage.');
 assert.equal(publisherBookLink(work,'<a href="https://evil.test/book">The Voyage</a><a href="/titles/voyage"><img alt="The Voyage"></a>',work.source_url),'https://publisher.test/titles/voyage');
 const page='<h1>The Voyage</h1><p>By Jane Author</p><meta property="og:description" content="'+('A source-backed expedition description with concrete discoveries. '.repeat(3))+'"><meta property="og:image" content="https://publisher.test/cover.jpg">';
 assert.match(publisherCandidate(work,page,work.source_url).synopsis,/expedition/);
 assert.equal(publisherCandidate({...work,authors:'A Different Person'},page,work.source_url),null);
 const reused=await enrichCatalogueWork({...work,synopsis:'Existing factual synopsis.',cover_url:'https://manual.test/cover.jpg'},{canonical:null,request:async()=>({bytes:new Uint8Array(20),type:'image/png'})});
 assert.equal(reused.synopsis,'Existing factual synopsis.');assert.equal(reused.cover_verified,undefined);
 assert.equal(await verifiedCover('https://test/image',async()=>({bytes:new Uint8Array(2000),type:'image/png'})),null);
 const retry=new Date(Date.now()+86400000).toISOString();const failed=await enrichCatalogueWork(work,{request:async()=>{throw Object.assign(new Error('Rate limited'),{retryAfter:retry});}});
 assert.equal(failed.retry_after,retry);assert.equal(failed.synopsis,null);assert.equal(failed.cover_url,undefined);
});
test('actual metadata worker rejects browser credentials and never substitutes AI inference',async()=>{
 const admin=memoryAdmin();const handler=await edgeHandler('catalogue-enrichment',admin);
 assert.equal((await handler({},{Authorization:'Bearer owner',apikey:'public','x-enrichment-scheduler-token':''})).status,401);assert.equal(admin.rpcCalls.length,0);
 admin.rpc=async name=>({data:name==='claim_catalogue_enrichment'?[]:true,error:null});
 assert.equal((await handler({})).data.checked,0);
});
test('cached real edition cover is validated during a Google search quota circuit',async()=>{
 const previous=globalThis.fetch;let fetched=0;
 try{
  const admin=memoryAdmin({collection_catalogue_books:[{...work,cover_url:'https://books.google.com/cover.jpg',synopsis:'An existing factual description.'}],enrichment_provider_state:[{provider:'google_books',retry_after:new Date(Date.now()+86400000).toISOString()}]});
  const original=admin.rpc.bind(admin);admin.rpc=async(name,args)=>name==='claim_catalogue_enrichment'?{data:[{work_key:work.key,claim_token:owner}],error:null}:original(name,args);
  const png=new Uint8Array(1500);png.set([137,80,78,71]);new DataView(png.buffer).setUint32(16,120);new DataView(png.buffer).setUint32(20,180);
  globalThis.fetch=async()=>{fetched++;return new Response(png,{headers:{'Content-Type':'image/png'}});};
  const response=await(await edgeHandler('catalogue-enrichment',admin))({});assert.equal(response.status,200);assert.equal(fetched,1);
  assert.equal(admin.rpcCalls.find(c=>c.name==='finish_catalogue_enrichment').args.p_result.cover_verified,true);
 }finally{globalThis.fetch=previous;}
});
test('negative reasoning remains visible, positive assessments drive suggestions and saved paths retain manual selections',()=>{
 const assessment={verdict:'not_recommended',appeal:'Discovery premise.',frustrations:'Slow relationship focus.',reasoning:'The pacing conflicts with your preference.',confidence:'Medium',taste_version:'version',assessed_at:'2026-10-26',evidence:[]};
 assert.match(assessmentBadge({assessment}),/Not Recommended/);assert.doesNotMatch(assessmentBadge({assessment}),/10 match/);assert.match(assessmentReason({assessment}),/Slow relationship focus/);
 const state={books:[],recommendations:[],collectionData:{collections:[{key:'test',name:'Test',kind:'series',members:[{work_key:'w'}]}],works:[{key:'w',title:'A',authors:'B'}],assessments:[{...assessment,work_key:'w'}]}};
 assert.equal(buildCollections(state)[0].recommended.length,0);
 state.collectionData.assessments[0].verdict='recommended';assert.equal(buildCollections(state)[0].recommended.length,1);
 state.collectionData.paths=[{id:'p',collection_key:'test'}];state.collectionData.entries=[{path_id:'p',work_key:'w',position:1,selection:'optional',reasoning:'Manual note'}];
 state.collectionData.assessments[0].verdict='not_recommended';assert.equal(buildCollections(state)[0].pathWorks[0].selection,'optional');assert.equal(buildCollections(state)[0].pathWorks[0].reasoning,'Manual note');
});
