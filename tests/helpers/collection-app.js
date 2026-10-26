import {expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {collectionArtwork} from '../../src/data/collection-artwork.js';
import {catalogueWorks,catalogueCollections} from '../../src/data/collection-catalogue.js';

export async function fixture(page,{theme='reading-room',backend=true,fail=false,delay=0,canonicalOnly=false,race=false,realArtwork=false,related=false,unmatchedSeries=false,base='/',onSelectedAdd=null,extraBooks=[]}={}) {
 const user={id:'10000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated'};
 const jwt=[{alg:'HS256'},{sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.test';
 await page.addInitScript(({user,jwt,theme})=>{
  localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:jwt,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,user}));
  localStorage.setItem('reading-room-theme',theme);
 },{user,jwt,theme});
 const books=[{id:'thunder',title:'Thunderhead',authors:'Douglas Preston, Lincoln Child',ownership_status:'Owned',overall_status:'Currently Reading',synopsis:'A verified expedition synopsis.',current_page:40,total_pages:400,progress_percent:10,cover_url:'/icons/icon-192.png'},
 {id:'jurassic',title:'Jurassic Park',authors:'Michael Crichton',ownership_status:'Owned',overall_status:'Read',synopsis:'A fictional dinosaur park.',cover_url:'/icons/icon-192.png'}];
 books.push(...extraBooks);
 if(realArtwork) {books[0].cover_url=collectionArtwork['pc:thunderhead'].cover_url;books[1].cover_url=collectionArtwork['crichton:jurassic-park'].cover_url;}
 if(related) books.push({id:'bob',title:'We Are Legion (We Are Bob)',authors:'Dennis E. Taylor',original_publication_year:2016,overall_status:'Read',ownership_status:'Owned',cover_url:'/icons/icon-192.png'},{id:'bob-2',title:'For We Are Many',authors:'Dennis E. Taylor',overall_status:'Owned - Unread',ownership_status:'Owned',cover_url:'/icons/icon-192.png'});
 const series=related?[{id:'bob-series',name:'Bobiverse'},{id:'jp-series',name:'Jurassic Park'}]:[];
 const bookSeries=related?[{book_id:'bob',series_id:'bob-series',series_order:1},{book_id:'bob-2',series_id:'bob-series',series_order:2},{book_id:'jurassic',series_id:'jp-series',series_order:1}]:[];
 const external=(title,authors,id,series_order=null)=>({kind:'external',title,authors,discovery_id:id,provider_id:`/books/${id.replace('W','M')}`,series_order,cover_url:'/icons/icon-192.png',add_payload:{open_library_work_id:id}});
 const lost=external('The Lost World','Michael Crichton','OL800W',2),worlds=external('All These Worlds','Dennis E. Taylor','OL801W',3);
 const relatedData={
  bob:{series:{id:'bob-series',name:'Bobiverse',current_order:1,total_books:3,books:[{kind:'library',book_id:'bob-2',...books.find(b=>b.id==='bob-2')},{kind:'library',book_id:'bob-2',...books.find(b=>b.id==='bob-2'),cover_url:'/icons/icon-512.png'},worlds,{...worlds,discovery_id:'edition-copy',provider_id:'/books/OL999M'}]},author:{name:'Dennis E. Taylor',books:[external('The Singularity Trap','Dennis E. Taylor','OL802W')]}},
  'bob-2':{series:{id:'bob-series',name:'Bobiverse',current_order:2,total_books:3,books:[{kind:'library',book_id:'bob',...books.find(b=>b.id==='bob')},worlds]},author:{name:'Dennis E. Taylor',books:[external('The Singularity Trap','Dennis E. Taylor','OL802W')]}},
  jurassic:{series:{id:unmatchedSeries?'unmatched-id':'jp-series',name:'Jurassic Park',current_order:1,total_books:2,books:[lost,{...lost,discovery_id:'other-edition',provider_id:'/books/OL998M'}]},author:{name:'Michael Crichton',books:[external('Sphere','Michael Crichton','OL803W')]}},
  thunder:{series:null,author:{name:'Douglas Preston',books:[external('Relic','Douglas Preston, Lincoln Child','OL804W')]}}
 };
 if(related) {
  relatedData.bob.series.books.unshift({...external('We Are Legion','Dennis E. Taylor','OL19123425W'),publication_year:2016});
  relatedData.bob.series.books.push({...external('The Bobiverse','Dennis E. Taylor','OL22116961W',1),publication_year:2016});
 }
 const works=catalogueWorks.map(w=>({...w,book_id:books.find(b=>b.title===w.title)?.id || null}));
 const collections=catalogueCollections.map(({members,...c})=>c);
 const memberships=catalogueCollections.flatMap(c=>c.members.map(m=>({...m,collection_key:c.key})));
 const recommendations=[{book_id:'thunder',match_score_10:9.3,why_recommended:'Your existing expedition recommendation.',recommendation_status:'Wishlist'}];
 const canonical=[...books];
 if(canonicalOnly||race) canonical.push({id:'relic',title:'Relic',authors:'Douglas Preston, Lincoln Child',cover_url_preferred:'/icons/icon-192.png'});
 let paths=[],entries=[],failReads=fail; const mutations=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const remote=base.startsWith('https:');
 await page.route('https://**/*',r=>(remote&&r.request().url().startsWith(base))||(realArtwork&&Object.values(collectionArtwork).some(a=>a.cover_url===r.request().url()))?r.continue():r.abort());
 await page.route('**/dist/app.js?*',async r=>{
  const bundle=remote?await(await r.fetch()).text():readFileSync('dist/app.js','utf8');
  return r.fulfill({contentType:'application/javascript',body:bundle.replaceAll('https://fbbpovieqfsjunmqtxvf.supabase.co',`${remote?'https':'http'}://127.0.0.1:4173/mock-supabase`)});
 });
 await page.route('**/mock-supabase/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  const table=path.split('/').at(-1);
  if(path.endsWith('/auth/v1/user')) return json(user);
  if(request.method()!=='GET') mutations.push({table,body:request.postDataJSON(),headers:request.headers()});
  if(related&&table==='related-books') return json(relatedData[request.postDataJSON().book_id] || null);
  if(related&&table==='library_add_related_result') return json({book_id:'fixture-related',already_in_library:false});
  if(table==='library_entries'&&request.method()==='POST') {
   const value=request.postDataJSON(),canonicalBook=canonical.find(b=>b.id===value.book_id);
   if(race&&value.book_id==='relic'&&!books.some(b=>b.id==='relic')) {
    books.push({...canonicalBook,cover_url:'https://selected-edition.test/relic.jpg',overall_status:'Read',ownership_status:'Owned',user_rating:5});return json([]);
   }
   if(books.some(b=>b.id===value.book_id)) return json([]);
   books.push({...canonicalBook,...value,cover_url:canonicalBook.cover_url_preferred});return json([{book_id:value.book_id}]);
  }
  if(table==='library_add_selected_result') {
   const payload=request.postDataJSON(),{p_result:result,p_status,p_ownership}=payload;
   const saved=onSelectedAdd?await onSelectedAdd(payload):null;
   const book={id:saved?.book_id || `new-${canonical.length}`,title:result.title,authors:result.authors.join(', '),overall_status:p_status,ownership_status:p_ownership};
   canonical.push(book);books.push(book);return json(saved || {book_id:book.id,already_in_library:false});
  }
  if(table==='save_reading_path') {
   const payload=request.postDataJSON();paths=[{id:'saved-path',collection_key:payload.p_collection_key,user_id:user.id}];
   entries=payload.p_entries.map((e,i)=>({...e,position:i+1,path_id:'saved-path',user_id:user.id}));return json('saved-path');
  }
  if(path.includes('/rpc/')) return json(null);
  if(table==='v_library') return json(url.searchParams.has('id')?books.find(b=>url.searchParams.get('id')===`eq.${b.id}`):books);
  if(table==='recommendations') return json(recommendations);
  if(table==='books') {
   if(url.searchParams.has('id')) return json({metadata_status:'complete'});
   return json(canonical.map(b=>({...b,cover_url_preferred:b.cover_url,book_authors:b.authors.split(', ').map((name,i)=>({author_order:i,authors:{name}}))})));
  }
  if(['collections','collection_catalogue_books','collection_memberships','reading_paths','reading_path_entries'].includes(table)) {
   if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
   if(!backend) return json({code:'PGRST205',message:'Table not in schema'},404);
   if(failReads) return json({code:'offline',message:'Offline'},503);
   return json({collections,collection_catalogue_books:works,collection_memberships:memberships,reading_paths:paths,reading_path_entries:entries}[table]);
  }
  if(table==='reader_profiles') return json(null);
  if(table==='series') return json(series);
  if(table==='book_series') return json(bookSeries);
  return json([]);
 });
 await page.goto(`${base}#/library`);await expect(page.locator('.library-grid')).toBeVisible();
 return {errors,mutations,books,recover(){failReads=false;},entries:()=>entries};
}
