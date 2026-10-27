import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryDb,finish} from '../helpers/collection-discovery-db.js';
import {bookId} from '../helpers/planner-db.js';
import {registry} from '../../supabase/functions/_shared/collection-registry.js';
import {discoverCollections,discoverWithProviders} from '../../supabase/functions/_shared/collection-discovery.js';

test('worker reloads catalogue provenance without recursive wrappers or repeated catalogue writes',async()=>{
 const book={id:bookId(1),title:'Gateway',authors:'Frederik Pohl',editions:[]},base={books:[book],series:[],book_series:[]};
 const db=await discoveryDb(base);
 try {
  let job=(await db.query('select * from public.claim_collection_discovery(1)')).rows[0];await finish(db,job,discoverCollections(book,base,registry));
  const load=async()=>({...base,series:(await db.query('select * from public.series')).rows,book_series:(await db.query('select * from public.book_series')).rows,collections:(await db.query('select * from public.collections')).rows,works:(await db.query('select * from public.collection_catalogue_books')).rows,memberships:(await db.query('select * from public.collection_memberships order by collection_key,work_key')).rows});
  const content=async()=>JSON.stringify((await db.query("select jsonb_build_object('collections',(select jsonb_agg(c order by key) from public.collections c),'works',(select jsonb_agg(w order by key) from public.collection_catalogue_books w),'memberships',(select jsonb_agg(m order by collection_key,work_key) from public.collection_memberships m)) data")).rows[0].data);
  let once;
  for(let replay=0;replay<3;replay++) {
   await db.exec("update public.collection_discovery_jobs set status='queued',attempt_count=0");job=(await db.query('select * from public.claim_collection_discovery(1)')).rows[0];
   const d=await discoverWithProviders(book,await load(),registry,{fetchJson:async()=>{throw Error('Verified database metadata should be reused.');}});
   assert.equal(d.status,'linked');assert.ok(d.collections.every(c=>!Object.hasOwn(c,'provenance')));assert.ok(d.works.every(w=>!Object.hasOwn(w,'provenance')));
   await finish(db,job,d);const current=await content();if(once)assert.equal(current,once);once=current;
  }
 }finally{await db.close();}
});
