import {expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {collectionArtwork} from '../../src/data/collection-artwork.js';
import {catalogueWorks,catalogueCollections} from '../../src/data/collection-catalogue.js';

export async function fixture(page,{theme='reading-room',backend=true,fail=false,delay=0,canonicalOnly=false,race=false,realArtwork=false,base='/'}={}) {
 const user={id:'10000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated'};
 const jwt=[{alg:'HS256'},{sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.test';
 await page.addInitScript(({user,jwt,theme})=>{
  localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:jwt,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,user}));
  localStorage.setItem('reading-room-theme',theme);
 },{user,jwt,theme});
 const books=[{id:'thunder',title:'Thunderhead',authors:'Douglas Preston, Lincoln Child',ownership_status:'Owned',overall_status:'Currently Reading',synopsis:'A verified expedition synopsis.',current_page:40,total_pages:400,progress_percent:10,cover_url:'/icons/icon-192.png'},
 {id:'jurassic',title:'Jurassic Park',authors:'Michael Crichton',ownership_status:'Owned',overall_status:'Read',synopsis:'A fictional dinosaur park.',cover_url:'/icons/icon-192.png'}];
 if(realArtwork) {books[0].cover_url=collectionArtwork['pc:thunderhead'].cover_url;books[1].cover_url=collectionArtwork['crichton:jurassic-park'].cover_url;}
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
  if(table==='library_entries'&&request.method()==='POST') {
   const value=request.postDataJSON(),canonicalBook=canonical.find(b=>b.id===value.book_id);
   if(race&&value.book_id==='relic'&&!books.some(b=>b.id==='relic')) {
    books.push({...canonicalBook,cover_url:'https://selected-edition.test/relic.jpg',overall_status:'Read',ownership_status:'Owned',user_rating:5});return json([]);
   }
   if(books.some(b=>b.id===value.book_id)) return json([]);
   books.push({...canonicalBook,...value,cover_url:canonicalBook.cover_url_preferred});return json([{book_id:value.book_id}]);
  }
  if(table==='library_add_selected_result') {
   const {p_result:result,p_status,p_ownership}=request.postDataJSON();
   const book={id:`new-${canonical.length}`,title:result.title,authors:result.authors.join(', '),overall_status:p_status,ownership_status:p_ownership};
   canonical.push(book);books.push(book);return json({book_id:book.id,already_in_library:false});
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
  return json([]);
 });
 await page.goto(`${base}#/library`);await expect(page.locator('.library-grid')).toBeVisible();
 return {errors,mutations,books,recover(){failReads=false;},entries:()=>entries};
}
