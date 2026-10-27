import test from 'node:test';
import assert from 'node:assert/strict';
import {discoveryDb,finish} from '../helpers/collection-discovery-db.js';
import {bookId} from '../helpers/planner-db.js';

test('verified local evidence requeues a provider retry while preserving provider and unrelated job deadlines',async()=>{
 const books=[{id:bookId(1),title:'First New',authors:'Test Author',editions:[]},{id:bookId(2),title:'Other Work',authors:'Test Author',editions:[]}];
 const db=await discoveryDb({books,series:[],book_series:[]});
 try {
  for(const book of books){const j=(await db.query('select * from public.claim_collection_discovery(1,$1)',[book.id])).rows[0];await finish(db,j,{},'Provider 429','2099-01-01');}
  await db.exec("insert into public.enrichment_provider_state(provider,retry_after) values('collection_publisher','2099-01-01')");
  const untouched=(await db.query('select * from public.collection_discovery_jobs where book_id=$1',[books[1].id])).rows[0];
  const catalogue={works:[{key:'new:one',title:'First New',authors:'Test Author'},{key:'new:two',title:'Second New',authors:'Test Author'}],collections:[{key:'new',name:'New Series',members:[{work_key:'new:one',official_number:1},{work_key:'new:two',official_number:2}]}]};
  await db.query("insert into public.collection_source_catalogues(key,source_url,status,catalogue,verified_at) values('new','https://quarto.com/source','verified',$1,now())",[JSON.stringify(catalogue)]);
  const j=(await db.query('select * from public.collection_discovery_jobs where book_id=$1',[books[0].id])).rows[0];assert.equal(j.status,'queued');assert.equal(j.attempt_count,0);assert.equal(j.revision,2);
  assert.deepEqual((await db.query('select * from public.collection_discovery_jobs where book_id=$1',[books[1].id])).rows[0],untouched);
  assert.equal(Date.parse((await db.query("select retry_after from public.enrichment_provider_state where provider='collection_publisher'")).rows[0].retry_after),Date.parse('2099-01-01'));
 }finally{await db.close();}
});
