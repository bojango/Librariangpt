import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCollections,catalogueBook,collectionMemberships,resolveWork,overviewCollections,groupedCollectionWorks,readingProgress,seriesCollectionRoutes} from '../../src/features/collections.js';
import {catalogueCollections,catalogueWorks} from '../../src/data/collection-catalogue.js';
import {collectionDetailView,collectionsView,catalogueBookView} from '../../src/views/collections.js';
import {parseRoute,routeHash} from '../../src/router.js';
import {sameRoute} from '../../src/lifecycle.js';
const authors='Douglas Preston, Lincoln Child';
const book={id:'thunder',title:'Thunderhead',authors,ownership_status:'Owned',overall_status:'Currently Reading'};
const state={books:[book],recommendations:[{book_id:'thunder',match_score_10:9.3,why_recommended:'Existing reason'}],route:{name:'collection',collectionKey:'preston-child'},collectionData:{books:[book]}};

test('series links use canonical identifiers and membership joins rather than heading/title comparisons',()=>{
 const jp={id:'jp',title:'Jurassic Park',authors:'Michael Crichton'};
 const bob={id:'bob',title:'We Are Legion (We Are Bob)',authors:'Dennis E. Taylor'};
 const s={books:[jp,bob],collectionData:{books:[jp,bob],series:[{id:'bob-series',name:'Bobiverse'},{id:'jp-series',name:'Jurassic Park'}],bookSeries:[{series_id:'bob-series',book_id:'bob',series_order:1},{series_id:'jp-series',book_id:'jp',series_order:1}]}};
 const routes=seriesCollectionRoutes(s);
 assert.equal(routes['bob-series'].collectionKey,'series:bob-series');
 assert.equal(routes['jp-series'].collectionKey,'jurassic-park');
 assert.equal(routes['not-an-id'],undefined);
 const explicit={...s,collectionData:{...s.collectionData,collections:[{key:'stable',name:'Renamed heading',kind:'series',series_id:'jp-series',members:[]}]}};
 assert.equal(seriesCollectionRoutes(explicit)['jp-series'].collectionKey,'stable');
});

test('ambiguous series-to-collection joins stay unlinked; internal subseries use the parent filter route',()=>{
 const relic={id:'relic',title:'Relic',authors};
 const s={books:[relic],collectionData:{books:[relic],series:[{id:'p',name:'Pendergast'}],bookSeries:[{series_id:'p',book_id:'relic'}]}};
 assert.deepEqual(seriesCollectionRoutes(s).p,{name:'collection',collectionKey:'preston-child',collectionFilter:'pendergast'});
 const shared={key:'book:relic',book_id:'relic',title:'Relic',authors};
 const ambiguous={...s,collectionData:{...s.collectionData,series:[],collections:[{key:'a',kind:'series',members:[{work_key:shared.key}]},{key:'b',kind:'series',members:[{work_key:shared.key}]}],works:[shared]}};
 assert.equal(seriesCollectionRoutes(ambiguous).p,undefined);
});

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
 assert.match(detail,/Based on your existing recommendations/);assert.doesNotMatch(detail,/Path 1/);
 assert.match(detail,/Suggested Reads/);assert.match(detail,/Full Collection/);
 assert.equal((detail.match(/class="nav-btn/g)||[]).length,4);
 assert.match(collectionsView({...state,collectionQuery:'not-a-series'}),/No matching collections/);
 assert.match(collectionsView({...state,collectionsLoading:true}),/Loading your collections/);
 assert.match(collectionsView({...state,collectionData:{error:'<unsafe>'}}),/&lt;unsafe&gt;/);
 assert.doesNotMatch(catalogueBookView(state,catalogueBook(state,'catalogue:pc:relic')),/Series & Collections|book-collection-membership/);
});


test('overview consolidates the universe and optionally distinguishes author collections',()=>{
 const s={...state,books:[...state.books,{id:'jp',title:'Jurassic Park',authors:'Michael Crichton'}]};
 assert.deepEqual(overviewCollections(s).map(c=>c.key),['preston-child','jurassic-park','silo']);
 const author=overviewCollections({...s,showAuthorCollections:true}).find(c=>c.kind==='author');
 assert.equal(author.name,'Michael Crichton');assert.equal(author.complete,false);assert.equal(author.verified,false);
 assert.match(author.description,/not an official series/);
 assert.equal(author.works.length,1);
});

test('universe groups every verified work once in official subseries order',()=>{
 const all=buildCollections(state),c=all.find(c=>c.key==='preston-child');
 const groups=groupedCollectionWorks(c,c.works,all);
 assert.deepEqual(groups.map(g=>g.key),['pendergast','nora-kelly','standalone']);
 assert.equal(groups.flatMap(g=>g.works).length,c.total);
 assert.equal(new Set(groups.flatMap(g=>g.works.map(w=>w.key))).size,c.total);
 assert.equal(groups[0].works[0].official_number,1);
 assert.equal(groups[1].works[0].publication_year,2019);
 assert.equal(groups[2].works[0].title,'Thunderhead');
});

test('full progress includes skipped books while path progress excludes skipped and forthcoming',()=>{
 const works=[{selection:'skipped',library:{overall_status:'Read'}},{selection:'optional'},{publication_state:'forthcoming'}];
 assert.deepEqual(readingProgress(works),{total:1,read:0});
 assert.deepEqual(readingProgress(works,{excludeSkipped:false}),{total:2,read:1});
 const s={...state,collectionData:{...state.collectionData,paths:[{id:'p',collection_key:'preston-child'}],entries:[{path_id:'p',work_key:'pc:thunderhead',position:1,selection:'skipped'},{path_id:'p',work_key:'pc:dead-mans-journey',position:2,selection:'recommended'}]}};
 const c=buildCollections(s).find(c=>c.key==='preston-child');
 assert.equal(c.fullProgress.total,30);assert.equal(c.pathProgress.total,0);assert.equal(c.forthcoming,1);
});

test('source-backed artwork is only a display fallback and never replaces edition covers',()=>{
 const c=buildCollections({...state,books:[{...book,cover_url:'selected-edition.jpg'}]}).find(c=>c.key==='preston-child');
 assert.equal(c.works.find(w=>w.key==='pc:thunderhead').cover_url,'selected-edition.jpg');
 assert.equal(c.works.find(w=>w.key==='pc:thunderhead').artwork_source,null);
 const relic=c.works.find(w=>w.key==='pc:relic');
 assert.match(relic.cover_url,/prestonchild.com/);assert.match(relic.artwork_source,/books\/relic/);
 assert.equal(relic.library,null);assert.equal(relic.recommendation,null);
 assert.ok(relic.add_payload.isbn10);
});

test('subseries filters round trip through navigation and have separate lifecycle keys',()=>{
 const route={name:'collection',collectionKey:'preston-child',collectionFilter:'nora-kelly',bookId:null};
 assert.deepEqual(parseRoute(routeHash(route)),route);
 assert.equal(sameRoute(route,{...route,collectionFilter:'pendergast'}),false);
 const view=collectionDetailView({...state,route,collectionMode:'full'});
 assert.match(view,/Old Bones/);assert.doesNotMatch(view,/>Relic<|>Thunderhead</);
 assert.match(view,/aria-current="page">Nora Kelly/);
});

test('unavailable backend hides path controls and keeps explicit wishlist actions',()=>{
 const view=collectionDetailView({...state,collectionMode:'full'});
 assert.doesNotMatch(view,/data-path-edit|data-path-save|Connected title|selection-recommended/);
 assert.match(view,/data-collection-add="pc:relic"/);
 assert.match(view,/Full collection/);assert.match(view,/Suggested reads/);
 assert.match(view,/status-pill collection-score/);
});
