import test from 'node:test';
import assert from 'node:assert/strict';
import {addCatalogueToWishlist} from '../../src/data/collections.js';
import {plannerDb,owner,other,bookId} from '../helpers/planner-db.js';

const work={key:'verified',title:'Relic',authors:'Douglas Preston, Lincoln Child',source_url:'https://www.prestonchild.com/books/relic/',add_payload:{isbn10:'0812543262'}};
const record={id:'canonical',title:work.title,book_authors:work.authors.split(', ').map((name,author_order)=>({author_order,authors:{name}}))};
function client({books=[record],existing=null,user='owner',editions=[],fail=null}={}) {
 const calls=[],entries=new Map(existing?[[record.id,{...existing}]]:[]);
 return {calls,entries,auth:{async getUser(){return {data:{user:user?{id:user}:null}};}},
  from(table){return {
   select(){return {async range(){return {data:books,error:fail};},async eq(){return {data:editions};}};},
   upsert(value,options){calls.push({table,value,options});return {async select(){
    const prior=entries.has(value.book_id);if(!prior) entries.set(value.book_id,value);
    return {data:prior?[]:[{book_id:value.book_id}]};
   }};}
  };},
  async rpc(name,args){calls.push({name,args});return {data:{book_id:'new-canonical',already_in_library:false}};}
 };
}

for(const status of ['Wishlist','Read','Currently Reading','Paused','DNF','Owned - Unread','Recommended','Not Interested']) test(`collection add preserves existing ${status}, ownership and edition`,async()=>{
 const existing={overall_status:status,ownership_status:'Owned',current_edition_id:'edition',user_rating_5:5,source:'existing'};
 const db=client({existing});const result=await addCatalogueToWishlist(work,db);
 assert.equal(result.already_in_library,true);assert.deepEqual(db.entries.get(record.id),existing);
 assert.deepEqual(db.calls[0].options,{onConflict:'book_id',ignoreDuplicates:true});
 assert.equal(db.calls.length,1);
});
test('canonical catalogue add only inserts Wishlist for the authenticated owner and coalesces concurrent clicks',async()=>{
 const db=client();const results=await Promise.all([addCatalogueToWishlist(work,db),addCatalogueToWishlist(work,db)]);
 assert.equal(db.calls.length,1);assert.equal(results[0].book_id,'canonical');
 assert.deepEqual(db.entries.get('canonical'),{user_id:'owner',book_id:'canonical',overall_status:'Wishlist',ownership_status:'Not Owned',source:'collection-catalogue'});
});
test('verified external edition uses existing ISBN-locked flow without changing edition artwork or series',async()=>{
 const db=client({books:[]});await addCatalogueToWishlist(work,db);
 assert.equal(db.calls.length,1);assert.equal(db.calls[0].name,'library_add_selected_result');
 const args=db.calls[0].args;assert.equal(args.p_status,'Wishlist');assert.equal(args.p_ownership,'Not Owned');
 assert.equal(args.p_result.isbn10,work.add_payload.isbn10);
 assert.equal('cover_url' in args.p_result,false);assert.equal('publication_year' in args.p_result,false);assert.equal('series_name' in args.p_result,false);
});
test('reversed co-author order reuses the canonical identity instead of creating another book',async()=>{
 const db=client({books:[{...record,book_authors:[...record.book_authors].reverse().map((entry,author_order)=>({...entry,author_order}))}]});
 const result=await addCatalogueToWishlist(work,db);
 assert.equal(result.book_id,record.id);assert.equal(db.calls.length,1);assert.equal(db.calls[0].table,'library_entries');
});
test('ambiguous identities, stale canonical links, ISBN collisions and unsigned users cannot write',async()=>{
 const cases=[{books:[record,{...record,id:'duplicate'}]},{books:[],editions:[{book_id:'other'}]},{user:null},{books:[record]}];
 for(const [i,options] of cases.entries()) {
  const db=client(options);
  await assert.rejects(addCatalogueToWishlist(i===3?{...work,book_id:'stale'}:work,db));assert.equal(db.calls.length,0);
 }
});
test('unverified editions do not invent an ISBN; exact external search results are required',async()=>{
 const db=client({books:[]});const missing={...work,add_payload:null};
 await assert.rejects(addCatalogueToWishlist(missing,db,async()=>[{title:'Other',authors:work.authors,isbn10:'0812543262'}]),/exact source-backed edition/);
 assert.equal(db.calls.length,0);
 await addCatalogueToWishlist(missing,db,async()=>[{title:work.title,authors:work.authors.split(', '),isbn10:'0812543262'}]);
 assert.equal(db.calls[0].args.p_result.isbn10,'0812543262');
});
test('canonical reads fail closed and do not make a speculative new book',async()=>{
 const db=client({fail:new Error('offline')});
 await assert.rejects(addCatalogueToWishlist(work,db),/offline/);assert.equal(db.calls.length,0);
});

test('real PostgreSQL conflict handling preserves reader rows and existing owner RLS blocks other identities',async()=>{
 const db=await plannerDb();
 const insert=(user,book)=>db.query("insert into public.library_entries(user_id,book_id,overall_status,ownership_status,source) values($1,$2,'Wishlist','Not Owned','collection-catalogue') on conflict(book_id) do nothing returning book_id",[user,book]);
 try {
  await db.query("insert into public.books(id,title) values($1,'Existing read'),($2,'Catalogue only')",[bookId(1),bookId(2)]);
  await db.query("insert into public.library_entries(user_id,book_id,overall_status,ownership_status,user_rating_5,user_review,current_page,total_pages,source) values($1,$2,'Read','Owned',5,'Keep this review',200,200,'existing')",[owner,bookId(1)]);
  const before=(await db.query('select * from public.library_entries')).rows[0];
  await db.exec('set role authenticated');
  assert.equal((await insert(owner,bookId(1))).rows.length,0);
  assert.deepEqual((await db.query('select * from public.library_entries where book_id=$1',[bookId(1)])).rows[0],before);
  assert.equal((await insert(owner,bookId(2))).rows.length,1);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
  assert.equal((await db.query('select * from public.library_entries')).rows.length,0);
  await assert.rejects(insert(other,bookId(2)),/row-level security/);
  await assert.rejects(insert(owner,bookId(2)),/row-level security/);
  await db.exec('reset role;set role anon');
  await assert.rejects(insert(other,bookId(2)));
 } finally {await db.close();}
});
