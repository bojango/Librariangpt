import test from 'node:test';
import assert from 'node:assert/strict';
import {edgeHandler,memoryAdmin} from '../helpers/enrichment-edge.js';

function client({serial=false}={}) {
 const admin=memoryAdmin({books:[{id:'current',title:serial?'Beacon 23':'First Voyage'}],authors:[{id:'author',name:serial?'Hugh Howey':'New Author'}],book_authors:[{book_id:'current',author_id:'author',author_order:1}],book_series:[{book_id:'current',series_id:'stable-series',series_order:1}],series:[{id:'stable-series',name:serial?'Beacon 23':'Voyages of Glass'}],collections:[{key:'stable',series_id:'stable-series',complete:true,catalogue_type:serial?'serialized_novel':'series'}],collection_memberships:[{collection_key:'stable',official_number:2,collection_catalogue_books:{key:'second',title:'Last Voyage',authors:'New Author',publication_year:2021}},{collection_key:'stable',official_number:null,collection_catalogue_books:{key:'stories',title:'Collected Voyages',authors:'New Author',publication_year:2022}}]});
 admin.auth={getUser:async()=>({data:{user:{id:'owner'}},error:null})};return admin;
}
test('actual related worker uses canonical IDs and verified complete sequence, with unnumbered collections last',async()=>{
 const previous=globalThis.fetch,urls=[];
 try {
  globalThis.fetch=async url=>{urls.push(String(url));return new Response(JSON.stringify({docs:[]}));};
  const result=await (await edgeHandler('related-books',client()))({book_id:'current'});
  assert.equal(result.status,200);assert.equal(result.data.series.id,'stable-series');assert.equal(result.data.series.total_books,3);
  assert.deepEqual(result.data.series.books.map(b=>b.title),['Last Voyage','Collected Voyages']);assert.equal(result.data.series.books[0].series_order,2);
  assert.equal(urls.some(u=>new URL(u).searchParams.has('q')),false);
 }finally{globalThis.fetch=previous;}
});
test('Beacon 23 never becomes a five-book provider series while legacy metadata remains present',async()=>{
 const previous=globalThis.fetch,urls=[];
 try {
  globalThis.fetch=async url=>{urls.push(String(url));return new Response(JSON.stringify({docs:Array.from({length:5},(_,i)=>({title:`Beacon 23 Part ${i+1}`,author_name:['Hugh Howey'],key:`/works/OL${i+1}W`,isbn:['9780306406157']}))}));};
  const admin=client({serial:true}),result=await (await edgeHandler('related-books',admin))({book_id:'current'});
  assert.equal(result.status,200);assert.equal(result.data.series,null);assert.equal(result.data.author.books.length,0);assert.equal(admin.tables.book_series.length,1);assert.equal(admin.tables.books.length,1);assert.equal(urls.some(u=>new URL(u).searchParams.has('q')),false);
 }finally{globalThis.fetch=previous;}
});
