import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {catalogueWorks,catalogueCollections} from '../../src/data/collection-catalogue.js';

async function fixture(page,{theme='reading-room',backend=true,fail=false,delay=0}={}) {
 const user={id:'10000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated'};
 const jwt=[{alg:'HS256'},{sub:user.id,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.test';
 await page.addInitScript(({user,jwt,theme})=>{
  localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:jwt,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,user}));
  localStorage.setItem('reading-room-theme',theme);
 },{user,jwt,theme});
 const books=[{id:'thunder',title:'Thunderhead',authors:'Douglas Preston, Lincoln Child',ownership_status:'Owned',overall_status:'Currently Reading',synopsis:'A verified expedition synopsis.',current_page:40,total_pages:400,progress_percent:10,cover_url:'/icons/icon-192.png'},
 {id:'jurassic',title:'Jurassic Park',authors:'Michael Crichton',ownership_status:'Owned',overall_status:'Read',synopsis:'A fictional dinosaur park.',cover_url:'/icons/icon-192.png'}];
 const works=catalogueWorks.map(w=>({...w,book_id:books.find(b=>b.title===w.title)?.id || null}));
 const collections=catalogueCollections.map(({members,...c})=>c);
 const memberships=catalogueCollections.flatMap(c=>c.members.map(m=>({...m,collection_key:c.key})));
 const recommendations=[{book_id:'thunder',match_score_10:9.3,why_recommended:'Your existing expedition recommendation.',recommendation_status:'Wishlist'}];
 let paths=[],entries=[],failReads=fail; const mutations=[],errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.abort());
 await page.route('**/dist/app.js?*',r=>r.fulfill({contentType:'application/javascript',body:readFileSync('dist/app.js','utf8').replaceAll('https://fbbpovieqfsjunmqtxvf.supabase.co','http://127.0.0.1:4173/mock-supabase')}));
 await page.route('**/mock-supabase/**',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  const table=path.split('/').at(-1);
  if(path.endsWith('/auth/v1/user')) return json(user);
  if(request.method()!=='GET') mutations.push({table,body:request.postDataJSON()});
  if(table==='save_reading_path') {
   const payload=request.postDataJSON();paths=[{id:'saved-path',collection_key:payload.p_collection_key,user_id:user.id}];
   entries=payload.p_entries.map((e,i)=>({...e,position:i+1,path_id:'saved-path',user_id:user.id}));return json('saved-path');
  }
  if(path.includes('/rpc/')) return json(null);
  if(table==='v_library') return json(url.searchParams.has('id')?books.find(b=>url.searchParams.get('id')===`eq.${b.id}`):books);
  if(table==='recommendations') return json(recommendations);
  if(table==='books') {
   if(url.searchParams.has('id')) return json({metadata_status:'complete'});
   return json(books.map(b=>({...b,cover_url_preferred:b.cover_url,book_authors:b.authors.split(', ').map((name,i)=>({author_order:i,authors:{name}}))})));
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
 await page.goto('/#/library');await expect(page.locator('.library-grid')).toBeVisible();
 return {errors,mutations,books,recover(){failReads=false;},entries:()=>entries};
}

for(const theme of ['reading-room','terminal']) test(`three collection screens, canonical status and catalogue-only navigation in ${theme}`,async({page},info)=>{
 const mock=await fixture(page,{theme});
 await page.getByRole('link',{name:'Collections',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Collections',exact:true,level:1})).toBeVisible();
 await expect(page.locator('.collection-card')).toHaveCount(6);
 await page.screenshot({path:info.outputPath(`collections-overview-${theme}.png`),fullPage:true});
 await expect(page.locator('.bottom-nav .nav-btn')).toHaveCount(4);
 await page.getByRole('searchbox',{name:'Search collections'}).fill('Nora');
 await expect(page.locator('.collection-card')).toHaveCount(3);
 await page.getByRole('searchbox',{name:'Search collections'}).fill('nothing matches');
 await expect(page.getByRole('heading',{name:'No matching collections'})).toBeVisible();
 await page.getByRole('searchbox',{name:'Search collections'}).fill('');
 await page.locator('.collection-card').filter({has:page.getByRole('heading',{name:'Preston–Child',exact:true})}).click();
 await expect(page.locator('.collection-explanation')).toContainText('No personalised path saved');
 await expect(page.locator('.collection-book')).toHaveCount(1);
 await page.locator('.collection-book h3 a').click();
 await expect(page.locator('.detail-header')).toBeVisible();
 await expect(page.locator('.book-collection-membership')).toHaveCount(2);
 const synopsis=page.locator('section').filter({has:page.getByRole('heading',{name:'Synopsis',exact:true})}).last();
 expect(await synopsis.evaluate(node=>node.nextElementSibling.classList.contains('book-collections'))).toBe(true);
 await page.locator('.book-collection-membership > a').filter({hasText:'Nora Kelly & Corrie Swanson'}).click();
 await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 await expect(page.locator('.collection-book')).toHaveCount(13);
 await expect(page.locator('.collection-book').filter({hasText:'Old Bones'})).toContainText('Not in Library');
 await expect(page.locator('.collection-book').filter({hasText:'Dead Man’s Journey'})).toContainText('2027 · Forthcoming');
 await page.locator('.collection-book h3 a').filter({hasText:'Old Bones'}).click();
 await expect(page.locator('.collection-catalogue-detail h1')).toHaveText('Old Bones');
 await expect(page.locator('[data-start],[data-finish],[data-collection-status]')).toHaveCount(0);
 await page.locator('[data-back]').click();await expect(page.locator('.collection-detail h1')).toHaveText('Nora Kelly & Corrie Swanson');
 await page.goBack();await expect(page.locator('.detail-header')).toBeVisible();
 await page.locator('[data-back]').click();await expect(page.locator('.collection-detail h1')).toHaveText('Preston–Child');
 await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 for(const width of [320,390,1024]) {
  await page.setViewportSize({width,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:info.outputPath(`collection-${theme}.png`),fullPage:true});
 expect(mock.errors).toEqual([]);
 // Existing book detail enrichment/related-book reads remain intact. A catalogue
 // visit never requests these for an external work or writes reader tables.
 expect(mock.mutations.filter(m=>!['refresh_up_next','book-background-enrich','related-books'].includes(m.table))).toEqual([]);
 expect(mock.mutations.filter(m=>['book-background-enrich','related-books'].includes(m.table)).every(m=>m.body.book_id==='thunder')).toBe(true);
});

test('explicit personalised path saves positions, optional/skipped selections and survives reload without library writes',async({page})=>{
 const mock=await fixture(page);
 await page.goto('/#/collection/jurassic-park');
 await expect(page.locator('.collection-heading')).toContainText('1 owned');
 await expect(page.locator('.collection-heading')).toContainText('1 read');
 await page.getByRole('button',{name:'Create reading path',exact:true}).click();
 await page.locator('[data-path-selection="crichton:jurassic-park"]').selectOption('optional');
 await page.locator('[data-path-selection="crichton:the-lost-world"]').selectOption('recommended');
 await page.getByRole('button',{name:'Move The Lost World earlier',exact:true}).click();
 await page.getByRole('button',{name:'Save reading path',exact:true}).click();
 await expect(page.locator('.collection-explanation')).toContainText('Your saved reading path');
 await expect(page.locator('.collection-book h3')).toHaveText(['The Lost World','Jurassic Park']);
 await expect(page.locator('.collection-book-order')).toHaveText(['Path 1 · 1995','Path 2 · 1990']);
 await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 await expect(page.locator('.collection-book h3')).toHaveText(['Jurassic Park','The Lost World']);
 await expect(page.locator('.collection-book-order')).toHaveText(['Series #1 · 1990','Series #2 · 1995']);
 await page.getByRole('button',{name:'Librarian’s Order',exact:true}).click();
 await page.reload();await expect(page.locator('.collection-book h3')).toHaveText(['The Lost World','Jurassic Park']);
 await page.getByRole('button',{name:'Edit reading path',exact:true}).click();
 await page.locator('[data-path-selection="crichton:jurassic-park"]').selectOption('skipped');
 await page.getByRole('button',{name:'Save reading path',exact:true}).click();
 await expect(page.locator('.collection-book.is-skipped')).toContainText('Jurassic Park');
 await expect.poll(()=>mock.entries()[1].selection).toBe('skipped');
 await expect(page.getByRole('button',{name:'Edit reading path',exact:true})).toBeVisible();
 expect(mock.mutations.filter(m=>!['refresh_up_next','save_reading_path'].includes(m.table))).toEqual([]);
 expect(mock.errors).toEqual([]);
});

test('unavailable backend has a useful read-only catalogue; transient errors offer recovery',async({page})=>{
 const mock=await fixture(page,{fail:true});
 await page.goto('/#/collections');
 await expect(page.locator('.collection-state')).toContainText('Saved reading paths could not be loaded');
 mock.recover();await page.getByRole('button',{name:'Try again',exact:true}).click();
 await expect(page.locator('.collection-state')).toHaveCount(0);
 await page.goto('/#/collection/silo');
 await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 await expect(page.locator('.collection-book h3')).toHaveText(['Wool','Shift','Dust']);
 expect(mock.errors).toEqual([]);
});
test('pre-migration deployment shows verified full collection without claiming saved paths work',async({page})=>{
 const mock=await fixture(page,{backend:false});
 await page.goto('/#/collection/silo');
 await expect(page.getByRole('button',{name:'Create reading path',exact:true})).toBeDisabled();
 await expect(page.locator('.path-actions')).toContainText('backend is enabled');
 await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 await expect(page.locator('.collection-book')).toHaveCount(3);
 expect(mock.errors).toEqual([]);
});
