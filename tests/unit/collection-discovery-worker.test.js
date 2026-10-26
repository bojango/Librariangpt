import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeHandler,memoryAdmin} from '../helpers/enrichment-edge.js';
import {catalogueRelatedItems} from '../../supabase/functions/_shared/collection-related.js';

function adminFor({title='Gateway',authors='Frederik Pohl',editions=[]}={}) {
 const admin=memoryAdmin({books:[{id:'book',title,metadata_status:'resolved'}],authors:authors.split(', ').map((name,i)=>({id:`author-${i}`,name})),
   book_authors:authors.split(', ').map((_,i)=>({book_id:'book',author_id:`author-${i}`,author_order:i+1})),editions:editions.map(e=>({...e,book_id:'book'})),series:[],book_series:[]});
 const original=admin.rpc.bind(admin);let due=true;
 admin.rpc=async(name,args)=>{
   if(name==='claim_collection_discovery') {admin.rpcCalls.push({name,args});const data=due?[{book_id:'book',revision:1,claim_token:'token',attempt_count:1}]:[];due=false;return {data,error:null};}
   return original(name,args);
 };
 return admin;
}
test('actual Edge worker handles metadata-complete books outside Library',async()=>{
 const admin=adminFor(),handler=await edgeHandler('collection-discovery',admin);
 const response=await handler({batch_size:4});assert.equal(response.status,202);
 const finish=admin.rpcCalls.find(c=>c.name==='finish_collection_discovery');
 assert.equal(finish.args.p_result.status,'linked');assert.equal(finish.args.p_token,'token');assert.equal(finish.args.p_revision,1);
 assert.equal(admin.tables.library_entries.length,0);assert.equal(admin.tables.editions.length,0);assert.equal(admin.tables.books[0].metadata_status,'resolved');
 assert.equal((await handler({})).data.checked,0);
});
test('worker rejects missing scheduler token, anonymous keys and owner browser credentials before claiming jobs',async()=>{
 const admin=adminFor(),handler=await edgeHandler('collection-discovery',admin);
 for(const headers of [{'x-enrichment-scheduler-token':''},{Authorization:'Bearer owner-session'},{Authorization:'Bearer anonymous',apikey:'public-key'}]) assert.equal((await handler({},headers)).status,401);
 assert.equal(admin.rpcCalls.length,0);
});
test('Edge worker respects Retry-After, persists provider circuit and records retryable failure',async()=>{
 const previous=globalThis.fetch;
 try {
  const admin=adminFor({title:'Unregistered work',authors:'Test Author',editions:[{id:'edition',open_library_work_id:'OL1W'}]});
  globalThis.fetch=async()=>new Response('limited',{status:429,headers:{'Retry-After':'86400'}});
  const handler=await edgeHandler('collection-discovery',admin),before=Date.now();
  assert.equal((await handler({})).status,202);
  const circuit=admin.rpcCalls.find(c=>c.name==='extend_enrichment_provider_backoff');
  assert.equal(circuit.args.p_provider,'collection_open_library');assert.ok(Date.parse(circuit.args.p_retry_after)>=before+86400000);
  const failure=admin.rpcCalls.find(c=>c.name==='finish_collection_discovery');
  assert.match(failure.args.p_error,/429/);assert.equal(failure.args.p_retry_after,circuit.args.p_retry_after);
 } finally {globalThis.fetch=previous;}
});
test('provider outage records failure while cached hints avoid another fetch',async()=>{
 const previous=globalThis.fetch;
 try {
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error('provider offline');};
  const broken=adminFor({title:'Unregistered',authors:'Test Author',editions:[{open_library_work_id:'OL1W'}]});
  await (await edgeHandler('collection-discovery',broken))({});
  assert.match(broken.rpcCalls.find(c=>c.name==='finish_collection_discovery').args.p_error,/offline/);
  const cached=adminFor({title:'Unregistered',authors:'Test Author',editions:[{open_library_work_id:'OL1W',metadata_payload:{open_library:{series:['Candidate only']}}}]});
  await (await edgeHandler('collection-discovery',cached))({});
  assert.equal(calls,1);assert.equal(cached.rpcCalls.find(c=>c.name==='finish_collection_discovery').args.p_result.status,'unresolved');
 } finally {globalThis.fetch=previous;}
});
test('catalogue shelf preserves canonical UUIDs, work routes, official numbers and excludes duplicate or forthcoming rows',()=>{
 const row=(key,book_id=null,publication_state='published')=>({official_number:2,collection_catalogue_books:{key,book_id,publication_state,title:key,authors:'Author',source_url:'https://publisher.example/book'}});
 const result=catalogueRelatedItems([row('current','current-id'),row('owned','owned-id'),row('missing'),row('future',null,'forthcoming')],[{book_id:'owned-id'}],'current-id','Canonical series');
 assert.equal(result.length,1);assert.equal(result[0].book_id,'catalogue:missing');assert.equal(result[0].series_order,2);
 assert.equal('add_payload' in result[0],false);
});

test('actual worker discovers a previously unregistered publisher series and persists reusable evidence without Library writes',async()=>{
 const previous=globalThis.fetch;
 try {
  const admin=adminFor({title:'First Voyage',authors:'New Author',editions:[{metadata_payload:{source_url:'https://www.quarto.com/books/first'}}]});
  const document={'@type':'BookSeries',name:'Voyages of Glass',numberOfItems:2,hasPart:[{'@type':'Book',name:'First Voyage',author:{name:'New Author'},position:1,datePublished:'2020-01-01'},{'@type':'Book',name:'Last Voyage',author:{name:'New Author'},position:2,datePublished:'2021-01-01'}]};
  globalThis.fetch=async()=>new Response(`<script type="application/ld+json">${JSON.stringify(document)}</script>`);
  await (await edgeHandler('collection-discovery',admin))({});
  const d=admin.rpcCalls.find(c=>c.name==='finish_collection_discovery').args.p_result;
  assert.equal(d.status,'linked');assert.equal(d.works.length,2);assert.equal(admin.tables.collection_source_catalogues[0].status,'verified');assert.equal(admin.tables.library_entries.length,0);assert.equal(admin.tables.books.length,1);assert.equal(admin.tables.collection_worker_smoke,undefined);
 }finally{globalThis.fetch=previous;}
});
test('publisher rate limits, open circuits, unsafe redirects and oversized responses are durable retryable failures',async()=>{
 const previous=globalThis.fetch;
 try {
  for(const failure of ['rate','circuit','redirect','oversize']) {
   let calls=0;const admin=adminFor({title:'First Voyage',authors:'New Author',editions:[{metadata_payload:{source_url:'https://quarto.com/first'}}]});
   if(failure==='circuit') admin.tables.enrichment_provider_state.push({provider:'collection_publisher',retry_after:'2099-01-01T00:00:00Z'});
   globalThis.fetch=async()=>{calls++;return failure==='rate'?new Response('',{status:429,headers:{'Retry-After':'86400'}}):failure==='redirect'?new Response('',{status:302,headers:{Location:'http://127.0.0.1/private'}}):new Response('x'.repeat(2000001));};
   await (await edgeHandler('collection-discovery',admin))({});
   const f=admin.rpcCalls.find(c=>c.name==='finish_collection_discovery');assert.ok(f.args.p_error);assert.equal(admin.tables.collection_source_catalogues,undefined);
   if(failure==='rate') {assert.equal(admin.rpcCalls.find(c=>c.name==='extend_enrichment_provider_backoff').args.p_provider,'collection_publisher');assert.ok(f.args.p_retry_after);}
   if(failure==='circuit') {assert.equal(calls,0);assert.equal(f.args.p_retry_after,'2099-01-01T00:00:00Z');}
   if(failure==='redirect') assert.match(f.args.p_error,/Untrusted/);
   if(failure==='oversize') assert.match(f.args.p_error,/exceeds limit/);
  }
 }finally{globalThis.fetch=previous;}
});
test('smoke evidence requires an explicit single-book request and a completed database outcome',async()=>{
 for(const status of ['unresolved','completed']) {
  const admin=adminFor();admin.tables.collection_discovery_jobs=[{book_id:'book',status}];
  await (await edgeHandler('collection-discovery',admin))({book_id:'book',smoke_test:true});
  assert.equal(Boolean(admin.tables.collection_worker_smoke),status==='completed');
  if(status==='completed') assert.equal(admin.tables.collection_worker_smoke[0].worker_revision,'fixture_project_function_version');
 }
 const admin=adminFor();assert.equal((await (await edgeHandler('collection-discovery',admin,{DENO_DEPLOYMENT_ID:undefined}))({book_id:'book',smoke_test:true})).status,503);assert.equal(admin.rpcCalls.length,0);
});
