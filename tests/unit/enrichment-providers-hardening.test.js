import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeHandler, memoryAdmin } from '../helpers/enrichment-edge.js';
import { goodreadsBookIdentity, goodreadsProviderIdentities, resolveGoodreadsCandidate } from '../../supabase/functions/_shared/goodreads.js';
import { buildEditionEnrichmentPatch } from '../../supabase/functions/_shared/edition-ranking.js';
import { fetchProviderJson, loadProviderDiagnostics } from '../../supabase/functions/_shared/provider-fetch.js';

const book = { id:'book', title:'Dark Matter', author:'Blake Crouch', isbn13:'9781101904220' };
const structured = overrides => `<script type="application/ld+json">${JSON.stringify({ '@type':'Book', name:book.title, author:{name:book.author}, isbn:book.isbn13,
  aggregateRating:{ratingValue:4.2,ratingCount:100,reviewCount:10}, ...overrides })}</script>`;
const known = goodreadsBookIdentity('123');
const seed = () => memoryAdmin({ books:[{id:book.id,title:book.title,authors:book.author,metadata_status:'partial',editions_status:'partial',cover_locked:false}],
  library_entries:[{book_id:book.id,ownership_status:'Not Owned'}],
  book_authors:[{book_id:book.id,author_order:1,authors:{name:book.author}}] });
const networkTest = (name,fn) => test(name,async t=>{
  const saved = {fetch:globalThis.fetch,Deno:globalThis.Deno,client:globalThis.__enrichmentTestClient};
  t.after(()=>{globalThis.fetch=saved.fetch;globalThis.Deno=saved.Deno;globalThis.__enrichmentTestClient=saved.client;});
  await fn(t);
});

test('persisted Goodreads ID bypasses all rediscovery and revalidates primary author', async () => {
  const calls=[];
  const fetched = await resolveGoodreadsCandidate(book,{identity:known,fetchPage:async url=>{calls.push(url);return {html:structured({}),finalUrl:url};}});
  assert.equal(fetched.result.match.tier,'ISBN_CONFIRMED');
  assert.deepEqual(calls,[known.sourceUrl]);
  const rejected = await resolveGoodreadsCandidate(book,{identity:known,fetchPage:async url=>({html:structured({author:{name:'Someone Else'}}),finalUrl:url})});
  assert.equal(rejected.result,null);
});

test('exact ISBN redirect works even when Goodreads search would return HTTP 202', async () => {
  const calls=[];
  const fetched = await resolveGoodreadsCandidate(book,{fetchPage:async url=>{
    calls.push(url); if(url.includes('/search')) throw Object.assign(new Error('not ready'),{status:202});
    return {html:structured({}),finalUrl:known.sourceUrl};
  }});
  assert.equal(fetched.result.identity.providerBookId,'123');
  assert.deepEqual(calls,[`https://www.goodreads.com/book/isbn/${book.isbn13}`]);
});

test('trusted provider Goodreads evidence follows ISBN failure and precedes search', async () => {
  const identities = goodreadsProviderIdentities([{metadata_payload:{open_library:{identifiers:{goodreads:['123']}}}}]);
  assert.deepEqual(identities,[known]);
  const calls=[];
  const fetched = await resolveGoodreadsCandidate(book,{providerIdentities:identities,fetchPage:async url=>{
    calls.push(url);if(url.includes('/isbn/')) throw new Error('request failed');
    return {html:structured({}),finalUrl:url};
  }});
  assert.equal(fetched.result.identity.providerBookId,'123');
  assert.deepEqual(calls,[`https://www.goodreads.com/book/isbn/${book.isbn13}`,known.sourceUrl]);
  assert.equal(fetched.diagnostic.attempts[0].error,'request failed');
});

test('title-only and ambiguous-author Goodreads candidates still reject', async () => {
  for (const target of [{...book,author:null},{...book,author:'Bob Crouch'}]) {
    const fetched = await resolveGoodreadsCandidate(target,{providerIdentities:[known],fetchPage:async url=>({html:structured({}),finalUrl:known.sourceUrl})});
    assert.equal(fetched.result,null);
  }
});

networkTest('confirmed Goodreads identity persists when rating is missing and later retry uses its direct page',async()=>{
  const admin=seed();
  admin.tables.editions.push({id:'edition',book_id:book.id,isbn13:book.isbn13});
  admin.tables.rating_refresh_state.push({book_id:book.id,provider:'Goodreads',failure_count:0});
  const refresh=await edgeHandler('goodreads-rating-refresh',admin);
  const calls=[];
  globalThis.fetch=async url=>{calls.push(String(url)); const r=new Response(structured({aggregateRating:undefined})); Object.defineProperty(r,'url',{value:known.sourceUrl}); return r;};
  const failed=await refresh({book_id:book.id});
  assert.equal(failed.data.results[0].ok,false);
  assert.equal(admin.tables.rating_refresh_state[0].provider_book_id,'123');
  assert.ok(admin.tables.rating_refresh_state[0].next_retry_at);
  assert.equal(admin.tables.public_ratings.length,0);
  calls.length=0;
  globalThis.fetch=async url=>{calls.push(String(url));return new Response(structured({}));};
  const success=await refresh({book_id:book.id,force:true});
  assert.equal(success.data.results[0].ok,true);
  assert.deepEqual(calls,[known.sourceUrl]);
  assert.equal(admin.tables.public_ratings[0].review_count,10);
});

networkTest('Google 429 in edition discovery prevents Google calls in content and Open Library still enriches',async()=>{
  const admin=seed();
  admin.tables.books[0].reference_edition_id='edition';
  admin.tables.editions.push({id:'edition',book_id:book.id,isbn13:book.isbn13,open_library_work_id:'OL123W',open_library_edition_id:'OL123M',owned:false,preferred_copy:false});
  const discovery=await edgeHandler('edition-options',admin);
  const content=await edgeHandler('content-enrichment',admin);
  const calls=[];
  globalThis.fetch=async url=>{
    url=String(url);calls.push(url);
    if(url.includes('googleapis'))return new Response('limited',{status:429,headers:{'Retry-After':'3600'}});
    if(url.includes('/editions.json'))return Response.json({entries:[]});
    if(url.includes('/isbn/'))return Response.json({key:'/books/OL123M',works:[{key:'/works/OL123W'}],number_of_pages:342,publishers:['Crown'],publish_date:'2016',physical_format:'Paperback',covers:[10]});
    if(url.includes('/ratings.json'))return Response.json({summary:{average:4,count:10}});
    if(url.includes('/works/OL123W.json'))return Response.json({description:'An Open Library synopsis',covers:[10]});
    throw new Error(`Unexpected URL: ${url}`);
  };
  const first=await discovery({book_id:book.id,enrichment:true});
  assert.equal(first.data.provider_diagnostics.google_books.rate_limited,true);
  assert.equal(admin.tables.enrichment_provider_state.length,1);
  const second=await content({book_id:book.id});
  assert.equal(second.status,200);
  assert.equal(second.data.status,'resolved');
  assert.equal(admin.tables.books[0].synopsis,'An Open Library synopsis');
  assert.equal(admin.tables.editions[0].page_count,342);
  assert.equal(admin.tables.editions[0].publisher,'Crown');
  assert.equal(admin.tables.editions[0].publication_year,2016);
  assert.equal(calls.filter(url=>url.includes('googleapis')).length,1);
  assert.ok(second.data.provider_diagnostics.google_books.skipped_due_to_rate_limit > 0);
});

networkTest('a stage loaded before another invocation trips Google backoff also skips the request',async()=>{
  const admin=seed();
  const earlier=await loadProviderDiagnostics(admin), later=await loadProviderDiagnostics(admin);
  let calls=0;globalThis.fetch=async()=>{calls++;return new Response('limited',{status:429,headers:{'Retry-After':'0'}});};
  await fetchProviderJson('https://www.googleapis.com/books/v1/volumes?q=first',100,later);
  await fetchProviderJson('https://www.googleapis.com/books/v1/volumes?q=second',100,earlier);
  assert.equal(calls,1);
  assert.equal(earlier.google_books.skipped_due_to_rate_limit,1);
  assert.ok(Date.parse(admin.tables.enrichment_provider_state[0].retry_after)-Date.now()>50000);
});

networkTest('content reuses Google edition payload without another Google request',async()=>{
  const admin=seed();
  admin.tables.books[0].reference_edition_id='edition';
  admin.tables.editions.push({id:'edition',book_id:book.id,isbn13:book.isbn13,metadata_payload:{google_books:{id:'volume',volumeInfo:{title:book.title,authors:[book.author],industryIdentifiers:[{type:'ISBN_13',identifier:book.isbn13}],description:'Cached synopsis',pageCount:342,publisher:'Crown',publishedDate:'2016',imageLinks:{thumbnail:'https://covers.example/1.jpg'}}}}});
  const content=await edgeHandler('content-enrichment',admin);
  const calls=[];globalThis.fetch=async url=>{calls.push(String(url));return Response.json({});};
  const result=await content({book_id:book.id});
  assert.equal(result.data.status,'resolved');
  assert.equal(admin.tables.books[0].synopsis,'Cached synopsis');
  assert.equal(result.data.provider_diagnostics.google_books.reused_evidence,1);
  assert.ok(!calls.some(url=>url.includes('googleapis')));
});

networkTest('Open Library identity alone does not permanently suppress Google synopsis gap filling',async()=>{
  const admin=seed();admin.tables.books[0].reference_edition_id='edition';
  admin.tables.editions.push({id:'edition',book_id:book.id,isbn13:book.isbn13,open_library_work_id:'OL123W',open_library_edition_id:'OL123M',page_count:342,publisher:'Crown',publication_year:2016,format:'Paperback',cover_url:'https://covers.example/1.jpg'});
  const content=await edgeHandler('content-enrichment',admin);const calls=[];
  globalThis.fetch=async url=>{
    calls.push(String(url));
    if(String(url).includes('googleapis'))return Response.json({items:[{id:'volume',volumeInfo:{title:book.title,authors:[book.author],industryIdentifiers:[{type:'ISBN_13',identifier:book.isbn13}],description:'Google-only synopsis',pageCount:342}}]});
    return Response.json({});
  };
  const result=await content({book_id:book.id,discovery_completed:true,google_attempted:0});
  assert.equal(result.data.status,'resolved');assert.equal(admin.tables.books[0].synopsis,'Google-only synopsis');
  const google=calls.filter(url=>url.includes('googleapis'));assert.equal(google.length,1);
  assert.equal(new URL(google[0]).searchParams.get('q'),`isbn:${book.isbn13}`);
});

networkTest('sufficient Open Library edition discovery avoids Google entirely',async()=>{
  const admin=seed();admin.tables.books[0].reference_edition_id='edition';
  admin.tables.editions.push({id:'edition',book_id:book.id,isbn13:book.isbn13,open_library_work_id:'OL123W',open_library_edition_id:'OL123M',page_count:342,publisher:'Crown',publication_year:2016,cover_url:'https://covers.example/1.jpg'});
  const discovery=await edgeHandler('edition-options',admin);const calls=[];
  globalThis.fetch=async url=>{calls.push(String(url));return Response.json({entries:[]});};
  const result=await discovery({book_id:book.id,enrichment:true});
  assert.equal(result.status,200);assert.ok(!calls.some(url=>url.includes('googleapis')));
});

networkTest('actual content handler preserves manually verified fields and uploaded/locked covers',async()=>{
  const admin=seed();
  admin.tables.books[0]={...admin.tables.books[0],metadata_status:'manual',metadata_source:'Manually verified',metadata_confidence:1,reference_edition_id:'edition',synopsis:'Manual synopsis',cover_locked:true,cover_url_preferred:'https://uploads.example/book.jpg'};
  admin.tables.editions.push({id:'edition',book_id:book.id,isbn13:book.isbn13,identity_locked:true,exact_copy_verified:true,page_count_verified:true,cover_uploaded_by_user:true,cover_locked:true,cover_url:'https://uploads.example/edition.jpg',page_count:400,publisher:'My publisher',publication_year:2000,format:'Hardcover',metadata_payload:{google_books:{id:'volume',volumeInfo:{title:book.title,authors:[book.author],industryIdentifiers:[{type:'ISBN_13',identifier:book.isbn13}],description:'Provider synopsis',pageCount:342,publisher:'Wrong',publishedDate:'2016',imageLinks:{thumbnail:'https://covers.example/wrong.jpg'}}}}});
  const content=await edgeHandler('content-enrichment',admin);
  globalThis.fetch=async()=>Response.json({});
  const result=await content({book_id:book.id});
  assert.equal(result.data.status,'manual');
  assert.equal(admin.tables.books[0].synopsis,'Manual synopsis');
  assert.equal(admin.tables.books[0].metadata_source,'Manually verified');
  assert.equal(admin.tables.books[0].metadata_confidence,1);
  assert.equal(admin.tables.books[0].cover_url_preferred,'https://uploads.example/book.jpg');
  assert.equal(admin.tables.editions[0].cover_url,'https://uploads.example/edition.jpg');
  assert.equal(admin.tables.editions[0].page_count,400);
  assert.equal(admin.tables.editions[0].publisher,'My publisher');
  assert.equal(admin.tables.editions[0].publication_year,2000);
  assert.equal(admin.tables.editions[0].format,'Hardcover');
  const patch=buildEditionEnrichmentPatch({exact_copy_verified:true,page_count_verified:true,cover_uploaded_by_user:true}, {isbn13:book.isbn13,page_count:400,cover_url:'https://wrong.example'},'now');
  assert.equal(patch.isbn13,undefined);assert.equal(patch.page_count,undefined);assert.equal(patch.cover_url,undefined);
});

networkTest('actual background worker defers partial attempts and completes metadata while Goodreads remains retryable',async()=>{
  for (const metadataComplete of [false,true]) {
    const admin=seed();
    const retryAt=new Date(Date.now()+6*3600000).toISOString();
    admin.tables.book_enrichment_jobs.push({id:'job',book_id:book.id,status:'queued',attempt_count:4});
    admin.tables.rating_refresh_state.push({book_id:book.id,provider:'Goodreads',failure_count:1,next_retry_at:retryAt});
    admin.tables.v_library_enrichment_health=[{book_id:book.id,metadata_complete:metadataComplete,goodreads_complete:false}];
    const background=await edgeHandler('book-background-enrich',admin);
    globalThis.fetch=async url=>{
      if(String(url).endsWith('/content-enrichment')){
        admin.tables.books[0].metadata_status=metadataComplete?'resolved':'partial';
        admin.tables.books[0].metadata_retry_after=retryAt;
      }
      return Response.json({ok:true,results:[{ok:false,status:'retry_scheduled'}]});
    };
    const result=await background({book_id:book.id});
    assert.equal(result.status,202);
    assert.equal(admin.tables.book_enrichment_jobs[0].status,metadataComplete?'completed':'deferred');
    assert.equal(admin.tables.book_enrichment_jobs[0].last_result.goodreads_complete,false);
    assert.equal(admin.tables.rating_refresh_state[0].next_retry_at,retryAt);
    if(!metadataComplete)assert.ok(Date.parse(admin.tables.book_enrichment_jobs[0].available_at)-Date.now()>6.9*24*3600000);
  }
});
