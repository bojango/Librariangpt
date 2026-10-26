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
