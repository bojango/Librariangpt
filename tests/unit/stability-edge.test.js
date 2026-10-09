import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { coherentIsbns, sameEdition, mergeEditionCandidates, buildEditionEnrichmentPatch } from '../../supabase/functions/_shared/edition-ranking.js';

test('provider metadata cannot join different ISBN identities or introduce implausible page counts',()=>{
 assert.equal(coherentIsbns({isbn13:'1234567890128'}).isbn13,null);
 assert.deepEqual(coherentIsbns({isbn13:'9780008279516',isbn10:'0008279519'}),{isbn13:'9780008279516',isbn10:'0008279519'});
 assert.equal(coherentIsbns({isbn13:'9780008279516',isbn10:'0306406152'}).isbn10,null);
 assert.equal(sameEdition({isbn13:'9780008279516',open_library_edition_id:'OL123M'},{isbn13:'9780306406157',open_library_edition_id:'OL123M'}),false);
 assert.equal(mergeEditionCandidates([{isbn13:'9780008279516',page_count:12549}])[0].page_count,null);
 const patch=buildEditionEnrichmentPatch({isbn10:'0306406152'},{isbn13:'9780008279516',page_count:12549},'now');
 assert.equal(patch.isbn13,undefined);assert.equal(patch.page_count,undefined);
});
import { edgeHandler, memoryAdmin } from '../helpers/enrichment-edge.js';

test('book and edition cover uploads validate ownership and bytes, and propagate persistence failures',async t=>{
 const saved={Deno:globalThis.Deno,client:globalThis.__enrichmentTestClient};t.after(()=>{globalThis.Deno=saved.Deno;globalThis.__enrichmentTestClient=saved.client;});
 const admin=memoryAdmin({library_entries:[{book_id:'book',user_id:'owner'}],editions:[{id:'edition',book_id:'book',owned:true}]});
 admin.auth={getUser:async()=>({data:{user:{id:'owner'}}})};let uploads=0,removed=0,fail=false;
 admin.storage={from:()=>({upload:async()=>{uploads++;return{};},getPublicUrl:path=>({data:{publicUrl:`https://covers.example/${path}`}}),remove:async()=>{removed++;}})};
 const rpc=admin.rpc;admin.rpc=async(name,args)=>name==='save_cover_selection'?(admin.rpcCalls.push({name,args}),{error:fail?{message:'Database unavailable'}:null}):rpc(name,args);
 const invoke=await edgeHandler('upload-cover-photo',admin);
 const body={book_id:'book',image_base64:Buffer.from([255,216,255,224,1,2,3]).toString('base64'),mime_type:'image/jpeg'};
 assert.equal((await invoke(body)).status,200);assert.equal(admin.rpcCalls.at(-1).args.p_edition_id,null);
 assert.equal((await invoke({...body,edition_id:'edition'})).status,200);assert.equal(admin.rpcCalls.at(-1).args.p_edition_id,'edition');
 assert.equal((await invoke({...body,edition_id:'wrong'})).status,404);
 assert.equal((await invoke({...body,book_id:'other'})).status,404);
 assert.equal((await invoke({...body,image_base64:'YWJj'})).status,422);
 fail=true;assert.equal((await invoke(body)).status,500);assert.equal(removed,1);assert.equal(uploads,3);
});

test('Yeti title fallback discovers editions while rejecting an unrelated author, and rate limits remain retryable',async t=>{
 const saved={fetch:globalThis.fetch,Deno:globalThis.Deno,client:globalThis.__enrichmentTestClient};t.after(()=>Object.assign(globalThis,{fetch:saved.fetch,Deno:saved.Deno,__enrichmentTestClient:saved.client}));
 const admin=memoryAdmin({books:[{id:'yeti',title:'Yeti: An Abominable History',authors:'Graham Hoyland'}],library_entries:[{book_id:'yeti',ownership_status:'Owned'}]});
 const evidence=JSON.parse(await readFile('tests/fixtures/yeti-editions.json','utf8'));
 const queries=[];
 globalThis.fetch=async value=>{const url=new URL(value);queries.push(url.href);
  if(url.hostname.includes('googleapis'))return new Response('{}',{status:429});
  if(url.pathname==='/search.json')return Response.json({docs:url.searchParams.get('title')==='Yeti'?[{key:'/works/OL21195450W',title:'Yeti',author_name:['Graham Hoyland']},{key:'/works/OL999W',title:'Yeti: An Abominable History',author_name:['Graham Smith']}]:[{key:'/works/OL999W',title:'Yeti: An Abominable History',author_name:['Graham Smith']}]});
  return Response.json({entries:evidence.entries});
 };
 const invoke=await edgeHandler('edition-options',admin);const result=await invoke({book_id:'yeti',force:true});
 assert.equal(result.data.count,3);assert.equal(result.data.work_id,'OL21195450W');assert.equal(admin.tables.editions[0].isbn13,'9780008279516');
 assert.ok(queries.some(q=>new URL(q).searchParams.get('title')==='Yeti'));
 const count=queries.length;await invoke({book_id:'yeti',force:true});assert.equal(queries.length,count);
 admin.tables.books[0].editions_last_refreshed_at=null;admin.tables.editions=[];
 globalThis.fetch=async()=>{throw new Error('Offline');};
 const failed=await invoke({book_id:'yeti',force:true});assert.equal(failed.data.status,'failed');assert.match(failed.data.message,/temporarily unavailable/);assert.equal(admin.tables.editions.length,0);
});
