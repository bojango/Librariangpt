import test from 'node:test';
import assert from 'node:assert/strict';
import {publisherCatalogue,authorityUrl,mergeDiscoveryRegistry,googleSeriesCandidate} from '../../supabase/functions/_shared/collection-providers.js';
import {discoverWithProviders} from '../../supabase/functions/_shared/collection-discovery.js';

const book={id:'unknown',title:'First Voyage',authors:'New Author',editions:[{isbn13:'9780306406157',metadata_payload:{source_url:'https://www.quarto.com/books/first'}}]};
const document={ '@type':'BookSeries',name:'Voyages of Glass',numberOfItems:2,hasPart:[
 {'@type':'Book',name:'First Voyage',author:{name:'New Author'},position:1,datePublished:'2020-01-01',isbn:'9780306406157',image:'https://publisher.example/first.jpg'},
 {'@type':'Book',name:'Last Voyage',author:{name:'New Author'},position:2,datePublished:'2021-01-01'}]};
const empty={version:1,works:[],collections:[]};
test('unknown series imports only explicit first-party membership, numbering, dates and artwork',async()=>{
 const d=await discoverWithProviders(book,{books:[book],book_series:[]},empty,{fetchDocument:async()=>`<script type="application/ld+json">${JSON.stringify(document)}</script>`});
 assert.equal(d.status,'linked');assert.equal(d.collections[0].complete,true);assert.equal(d.works.length,2);
 assert.deepEqual(d.collections[0].members.map(m=>m.official_number),[1,2]);
 assert.deepEqual(d.works.map(w=>w.publication_year),[2020,2021]);assert.equal(d.works[0].book_id,book.id);assert.equal(d.works[1].book_id,null);
 assert.equal(d.works[0].cover_url,'https://publisher.example/first.jpg');assert.equal(d.source_catalogue.status,'verified');
});
test('untrusted domains, similarly named authors, duplicate works and duplicate official numbers cannot establish a series',async()=>{
 assert.equal(authorityUrl('https://quarto.com.attacker.example/books'),null);
 for(const url of ['http://www.quarto.com','https://user:password@quarto.com','https://quarto.com:444']) assert.equal(authorityUrl(url),null);
 assert.equal(await publisherCatalogue(document,'https://unknown.example',book),null);
 assert.equal(await publisherCatalogue(document,'https://quarto.com', {...book,authors:'Other Author'}),null);
 for(const part of [{...document.hasPart[0]},{...document.hasPart[1],position:1},{...document.hasPart[1],isbn:document.hasPart[0].isbn}]) assert.equal(await publisherCatalogue({...document,hasPart:[document.hasPart[0],part]},'https://quarto.com',book),null);
});
test('positions are never inferred from array order and undeclared or paginated totals remain incomplete',async()=>{
 const raw=structuredClone(document);delete raw.numberOfItems;delete raw.hasPart[0].position;
 const c=(await publisherCatalogue(raw,'https://quarto.com',book)).collections[0];
 assert.equal(c.complete,false);assert.equal(c.members[0].official_number,null);
 assert.equal((await publisherCatalogue({...document,nextPage:'page2'},'https://quarto.com',book)).collections[0].complete,false);
});
test('database catalogues match new books without another provider request or static registry entry',async()=>{
 const c=await publisherCatalogue(document,'https://quarto.com',book);
 const s={books:[book],book_series:[],works:c.works,collections:c.collections,memberships:c.collections[0].members.map(m=>({...m,collection_key:c.collections[0].key}))};
 const result=await discoverWithProviders(book,s,empty,{fetchJson:async()=>{throw Error('must reuse catalogue');}});
 assert.equal(result.status,'linked');assert.equal(result.collections[0].key,c.collections[0].key);
});
test('later service-verified sources resolve previously unknown works and retain existing collection and work keys',async()=>{
 const c=await publisherCatalogue(document,'https://quarto.com',book);
 const old={...c,works:c.works.map((w,i)=>({...w,key:`old-${i}`})),collections:[{...c.collections[0],key:'stable',members:c.collections[0].members.map((m,i)=>({...m,work_key:`old-${i}`}))}]};
 const merged=mergeDiscoveryRegistry({sources:[{status:'verified',catalogue:c}]},old);
 assert.equal(merged.works.length,2);assert.equal(merged.collections.length,1);assert.equal(merged.collections[0].key,'stable');
 const d=await discoverWithProviders(book,{books:[book],book_series:[],sources:[{status:'verified',catalogue:c}]},empty);
 assert.equal(d.status,'linked');
 assert.equal(mergeDiscoveryRegistry({sources:[{status:'candidate',catalogue:c},{status:'verified',catalogue:{works:{},collections:[]}}]},empty).works.length,0);
});
test('Google series metadata reuses cached ISBN evidence, paginates and remains review evidence',async()=>{
 const volume={id:'volume',volumeInfo:{title:book.title,authors:[book.authors],industryIdentifiers:[{identifier:'9780306406157'}],seriesInfo:{volumeSeries:[{seriesId:'series-1',orderNumber:1}],bookDisplayNumber:'Book One'}}};
 const b={...book,editions:[{isbn13:'9780306406157',metadata_payload:{google_books:volume}}]},urls=[];
 const candidate=await googleSeriesCandidate(b,async url=>{urls.push(url);return url.includes('/series/get')?{series:[{seriesId:'series-1',title:document.name}]}:url.includes('page_token')?{member:[]}:{member:[volume],nextPageToken:'next'};});
 assert.equal(urls.length,3);assert.equal(urls.some(u=>u.includes('/volumes?')),false);assert.equal(candidate.verified,false);assert.equal(candidate.pagination_complete,true);assert.equal(candidate.members[0].provider_order,1);
 const wrong={...b,title:'Title collision'};assert.equal(await googleSeriesCandidate(wrong,async()=>({items:[volume]})),null);
});
