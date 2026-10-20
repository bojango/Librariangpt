import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCollections,catalogueBook,collectionMemberships,resolveWork} from '../../src/features/collections.js';
import {catalogueCollections,catalogueWorks} from '../../src/data/collection-catalogue.js';
import {collectionDetailView,collectionsView,bookCollectionsSection} from '../../src/views/collections.js';
import {parseRoute,routeHash} from '../../src/router.js';
import {sameRoute} from '../../src/lifecycle.js';
const authors='Douglas Preston, Lincoln Child';
const book={id:'thunder',title:'Thunderhead',authors,ownership_status:'Owned',overall_status:'Currently Reading'};
const state={books:[book],recommendations:[{book_id:'thunder',match_score_10:9.3,why_recommended:'Existing reason'}],route:{name:'collection',collectionKey:'preston-child'},collectionData:{books:[book]}};

test('one canonical work can belong to universe and crossover without duplicating it or library entries',()=>{
 const memberships=collectionMemberships(state,book);
 assert.deepEqual(memberships.map(m=>m.collection.key),['preston-child','nora-corrie']);
 assert.equal(memberships[0].collection.works.filter(w=>w.book_id==='thunder').length,1);
 assert.equal(state.books.length,1);
 assert.equal(resolveWork(catalogueWorks.find(w=>w.key==='pc:thunderhead'),[book,book]).id,'thunder');
 assert.equal(resolveWork({...catalogueWorks[0],book_id:null},[{...book,title:'Relic',authors:'Other Writer'}]),null);
});
test('catalogue includes missing works without claiming ownership, completion or recommendation',()=>{
 const c=buildCollections(state).find(c=>c.key==='preston-child');
 assert.equal(c.owned,1);assert.equal(c.read,0);assert.equal(c.progress,0);
 const missing=c.works.find(w=>w.key==='pc:relic');assert.equal(missing.library,null);assert.equal(missing.recommendation,null);
 assert.equal(catalogueBook(state,'catalogue:pc:relic').catalogue_only,true);
 assert.equal(catalogueBook(state,'unknown'),null);
});
test('official number and path order remain separate, with optional and skipped context',()=>{
 const s={...state,collectionData:{...state.collectionData,paths:[{id:'p',collection_key:'pendergast'}],entries:[{path_id:'p',work_key:'pc:whitefire',position:1,selection:'recommended',reasoning:'User confirmed'},{path_id:'p',work_key:'pc:relic',position:2,selection:'optional'},{path_id:'p',work_key:'pc:cabinet',position:3,selection:'skipped'}]}};
 const c=buildCollections(s).find(c=>c.key==='pendergast');
 assert.equal(c.works[0].title,'Relic');assert.equal(c.works.find(w=>w.title==='White Fire').official_number,13);
 assert.deepEqual(c.pathWorks.map(w=>w.position),[1,2,3]);assert.equal(c.recommended.length,2);
 assert.equal(c.pathWorks[2].selection,'skipped');
 const cross={...s,collectionData:{...s.collectionData,paths:[{id:'p',collection_key:'jurassic-park'}]}};
 assert.equal(buildCollections(cross).find(c=>c.key==='jurassic-park').pathWorks[0].title,'White Fire');
});
test('read and owned counts use independent canonical statuses; On Order is not owned',()=>{
 const works=catalogueWorks.filter(w=>w.key.startsWith('crichton:'));
 const books=works.map((w,i)=>({id:String(i),title:w.title,authors:w.authors,ownership_status:i?'On Order':'Not Owned',overall_status:i?'Wishlist':'Read'}));
 const c=buildCollections({books}).find(c=>c.key==='jurassic-park');
 assert.equal(c.owned,0);assert.equal(c.read,1);assert.equal(c.progress,50);assert.equal(c.total,2);
});
test('source catalogue has stable unique works, no fabricated series number for Thunderhead and an explicit forthcoming title',()=>{
 assert.equal(new Set(catalogueWorks.map(w=>w.key)).size,catalogueWorks.length);
 for(const c of catalogueCollections) for(const m of c.members) assert.ok(catalogueWorks.some(w=>w.key===m.work_key));
 assert.equal(catalogueCollections.find(c=>c.key==='nora-kelly').members[0].work_key,'pc:old-bones');
 assert.equal(catalogueWorks.find(w=>w.key==='pc:dead-mans-journey').publication_state,'forthcoming');
 assert.equal(catalogueWorks.find(w=>w.key==='pc:diablomesa').publication_year,2022);
});
test('collection routes preserve identity and use distinct lifecycle keys',()=>{
 const route={name:'collection',collectionKey:'nora-corrie',bookId:null};
 assert.deepEqual(parseRoute(routeHash(route)),route);
 assert.equal(sameRoute(route,{...route,collectionKey:'silo'}),false);
 assert.deepEqual(parseRoute('#/collections'),{name:'collections',bookId:null});
});
test('views escape reasons, show missing data, expose search, maintain navigation and never invent path positions',()=>{
 const detail=collectionDetailView(state);
 assert.match(detail,/No personalised path saved yet/);assert.doesNotMatch(detail,/Path 1/);
 assert.match(detail,/Librarian’s Order/);assert.match(detail,/Full Collection/);
 assert.equal((detail.match(/class="nav-btn/g)||[]).length,4);
 assert.match(collectionsView({...state,collectionQuery:'not-a-series'}),/No matching collections/);
 assert.match(collectionsView({...state,collectionsLoading:true}),/Loading your collections/);
 assert.match(collectionsView({...state,collectionData:{error:'<unsafe>'}}),/&lt;unsafe&gt;/);
 assert.match(bookCollectionsSection(state,book),/Series & Collections/);
 assert.doesNotMatch(bookCollectionsSection(state,book),/Series #1/);
});
