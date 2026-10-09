import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
const project='fbbpovieqfsjunmqtxvf';
const png=readFileSync('icons/icon-192.png');

async function isolatedApp(page,{edition=false,discoverySuccess=false}={}) {
 const user={id:'test-owner',aud:'authenticated',role:'authenticated',email:'fixture@example.test'};
 const jwt=[{alg:'HS256',typ:'JWT'},{sub:user.id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.test';
 await page.addInitScript(({project,user,jwt})=>{window.__stabilityRejections=[];window.addEventListener('unhandledrejection',e=>window.__stabilityRejections.push(String(e.reason)));Object.defineProperty(navigator,'standalone',{value:true});if(!localStorage.getItem(`sb-127-auth-token`))localStorage.setItem(`sb-127-auth-token`,JSON.stringify({access_token:jwt,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,user}));},{project,user,jwt});
 let selected=edition?'edition-1':null,cover='',uploadFailure=false,discoveryCalls=0,discovered=false;const uploads=[],editions=edition?[{id:'edition-1',book_id:'yeti',isbn13:'9780008279493',publisher:'William Collins',publication_year:2018,page_count:320}]:[];
 const errors=[];page.on('requestfailed',r=>console.log('STABILITY_FAILED_REQUEST',r.url(),r.failure()?.errorText));page.on('pageerror',e=>{errors.push(e.message);console.log('STABILITY_PAGE_ERROR',e.stack);});
 const book=()=>({id:'yeti',title:'Yeti: An Abominable History',authors:'Graham Hoyland',overall_status:'Owned - Unread',ownership_status:'Owned',current_edition_id:selected,display_edition_id:selected,total_pages:320,cover_url:cover,metadata_status:'complete',synopsis:'Isolated test record.'});
 const books=()=>[book(),{id:'wish',title:'Wishlist fixture',authors:'Test',overall_status:'Wishlist',ownership_status:'Not Owned'},...Array.from({length:35},(_,i)=>({id:`extra-${i}`,title:`Extra ${i}`,authors:'Test',overall_status:'Owned - Unread',ownership_status:'Owned'}))];
 // All remote requests are intercepted. No genuine history or account is touched.
 await page.route('https://**/*',route=>route.abort());
 await page.route('**/dist/app.js?*',route=>route.fulfill({contentType:'application/javascript',body:readFileSync('dist/app.js','utf8').replaceAll('https://fbbpovieqfsjunmqtxvf.supabase.co','http://127.0.0.1:4173/mock-supabase')}));
 await page.route('**/mock-supabase/**',async route=>{
  const url=new URL(route.request().url()),path=url.pathname.replace('/mock-supabase','');
  const json=value=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value),headers:{'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'GET,POST,PATCH,OPTIONS'}});
  if(route.request().method()==='OPTIONS')return json({});

  if(path==='/auth/v1/user')return json(user);
  if(path.includes('/functions/v1/upload-cover-photo')){if(uploadFailure)return route.abort('failed');const data=route.request().postDataJSON();uploads.push(data);await new Promise(r=>setTimeout(r,80));cover=`/test-cover-${uploads.length}.png`;return json({ok:true,cover_url:cover});}
  if(path.includes('/functions/v1/cover-options'))return json({candidates:[]});
  if(path.includes('/functions/v1/select-cover')){cover='/test-cover-url.png';return json({ok:true,cover_url:cover});}
  if(path.includes('/functions/v1/edition-options')){discoveryCalls++;if(discoverySuccess){discovered=true;const fixture=JSON.parse(readFileSync('tests/fixtures/yeti-editions.json','utf8'));for(const [i,e] of fixture.entries.entries())editions.push({id:`provider-${i}`,book_id:'yeti',isbn13:e.isbn_13[0],publisher:e.publishers[0],publication_year:Number(e.publish_date),language:'English',page_count:e.number_of_pages||Number(e.pagination)||null});return json({status:'ready',count:editions.length});}return json({status:'failed',count:0,message:'Edition providers are temporarily unavailable. Retry later or add a verified edition manually.'});}
  if(path.includes('/rpc/add_manual_edition')){const data=route.request().postDataJSON();if(!editions.length)editions.push({id:'manual',book_id:'yeti',isbn13:data.p_isbn,publisher:data.p_publisher,publication_year:data.p_year,format:data.p_format,page_count:data.p_pages});return json('manual');}
  if(path.includes('/rpc/select_book_edition')){selected=route.request().postDataJSON().p_edition_id;return json({saved:true});}
  if(path.includes('/rest/v1/book_cover_candidates'))return json({id:'manual-url'});
  if(path.includes('/rest/v1/v_library'))return json(url.searchParams.has('id')?book():books());
  if(path.includes('/rest/v1/editions'))return json(editions);
  if(path.includes('/rest/v1/books'))return json({editions_status:discovered?'ready':'failed',editions_error:discovered?null:'Providers temporarily unavailable',editions_last_refreshed_at:new Date().toISOString(),metadata_status:'complete'});
  if(path.includes('/rest/v1/reader_profiles'))return json(null);
  if(path.includes('/rest/v1/rpc/'))return json(null);
  return json([]);
 });
 await page.route('**/test-cover-*.png',route=>route.fulfill({contentType:'image/png',body:png}));
 await page.goto('/#/book/yeti');await expect(page.locator('.detail-header[data-book-id="yeti"]')).toBeVisible();
 return {uploads,errors,get discoveryCalls(){return discoveryCalls;},failUpload(value){uploadFailure=value;}};
}
async function coverForm(page){await page.locator('[data-cover-picker]').click();await expect(page.locator('#custom-cover')).toBeVisible();}
async function imageUpload(page){await page.locator('[name="file"]').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:png});await page.getByRole('button',{name:'Save cover',exact:true}).click();}
async function assertBrowserErrors(page,mock){
 expect(await page.evaluate(()=>window.__stabilityRejections)).toEqual([]);
 // Windows WebKit reports an inspector-blocked/cancelled fetch as a pageerror,
 // even when the application catches it. Retain those engine diagnostics.
 await test.info().attach('observed-page-errors',{body:JSON.stringify(mock.errors),contentType:'application/json'});
 expect(mock.errors.filter(message=>!/^\/127\.0\.0\.1:4173\/mock-supabase\/rest\/v1\/.* due to access control checks\.$/.test(message))).toEqual([]);
}

test('book-level covers, invalid images, upload failure, URLs and persistence',async({page},info)=>{
 await page.setViewportSize({width:440,height:894});const mock=await isolatedApp(page);
 await coverForm(page);await imageUpload(page);await expect(page.locator('#toast')).toContainText('uploaded and saved');expect(mock.uploads[0].edition_id).toBeNull();
 await page.waitForLoadState('networkidle');await page.reload();await expect(page.locator('.detail-header .cover-image')).toHaveAttribute('src',/test-cover-1/);
 await coverForm(page);await page.locator('[name="file"]').setInputFiles({name:'bad.jpg',mimeType:'image/jpeg',buffer:Buffer.from('invalid')});await page.getByRole('button',{name:'Save cover',exact:true}).click();await expect(page.locator('#toast')).toContainText('valid image');await expect(page.getByRole('button',{name:'Save cover',exact:true})).toBeEnabled();
 mock.failUpload(true);await imageUpload(page);await expect(page.locator('#toast')).toHaveClass(/error/);await expect(page.getByRole('button',{name:'Save cover',exact:true})).toBeEnabled();mock.failUpload(false);
 await page.locator('[name="file"]').setInputFiles([]);await page.locator('[name="url"]').fill('http://127.0.0.1:4173/test-cover-url.png');await page.getByRole('button',{name:'Save cover',exact:true}).click();await expect(page.locator('#toast')).toContainText('Cover saved');
 await page.waitForLoadState('networkidle');await page.reload();await expect(page.locator('.detail-header .cover-image')).toHaveAttribute('src',/test-cover-url/);
 await assertBrowserErrors(page,mock);await mkdir('output/playwright',{recursive:true});await page.screenshot({animations:'disabled',path:`output/playwright/cover-book-${info.project.name}.png`});
});

test('edition cover replacement persists and manual catalogue works through provider failure',async({page},info)=>{
 await page.setViewportSize({width:440,height:894});const mock=await isolatedApp(page,{edition:true});
 for(let i=0;i<2;i++){await coverForm(page);await imageUpload(page);await expect(page.locator('#toast')).toContainText('uploaded and saved');await expect(page.locator('#modal-root')).toBeEmpty();}
 expect(mock.uploads.map(x=>x.edition_id)).toEqual(['edition-1','edition-1']);await page.waitForLoadState('networkidle');await page.reload();await expect(page.locator('.detail-header .cover-image')).toHaveAttribute('src',/test-cover-2/);
 await page.locator('.metadata-accordion summary').click();await page.locator('[data-editions]').click();await page.locator('[data-edition-refresh]').click();await expect(page.locator('#toast')).toContainText('temporarily unavailable');expect(mock.discoveryCalls).toBe(1);
 await page.locator('[data-edition-manual]').click();await page.getByLabel('ISBN',{exact:true}).fill('9780008279493');await page.getByLabel('Publisher',{exact:true}).fill('William Collins');await page.getByLabel('Publication year').fill('2018');await page.getByLabel('Pages',{exact:true}).fill('320');await page.getByLabel('Format',{exact:true}).selectOption('Hardcover');await page.getByLabel('Source URL or physical-copy evidence').fill('https://www.psbooks.co.uk/yeti');await page.getByLabel('I checked the ISBN').check();await page.getByRole('button',{name:'Add edition',exact:true}).click();await expect(page.locator('.edition-row')).toHaveCount(1);await expect(page.locator('.edition-browser-modal')).toBeVisible();
 await page.screenshot({animations:'disabled',path:`output/playwright/edition-${info.project.name}.png`});await assertBrowserErrors(page,mock);
});

test('manual edition creation, selection and refresh with no provider records',async({page})=>{
 const mock=await isolatedApp(page);await page.locator('.metadata-accordion summary').click();await page.locator('[data-editions]').click();await page.locator('[data-edition-manual]').click();
 await page.getByLabel('ISBN',{exact:true}).fill('9780008279517');await page.getByLabel('Source URL or physical-copy evidence').fill('https://www.psbooks.co.uk/yeti');await page.getByLabel('I checked the ISBN').check();await page.getByRole('button',{name:'Add edition',exact:true}).click();await expect(page.locator('[data-manual-error]')).toContainText('valid ISBN');
 await page.getByLabel('ISBN',{exact:true}).fill('9780008279493');await page.getByRole('button',{name:'Add edition',exact:true}).click();await page.locator('[data-edition-own="manual"]').click();await expect(page.locator('#modal-root')).toBeEmpty();await page.waitForLoadState('networkidle');await page.reload();await page.locator('.metadata-accordion summary').click();await page.locator('[data-editions]').click();await expect(page.locator('.edition-current-label')).toContainText('Current edition');await assertBrowserErrors(page,mock);
});

test('Yeti discovery renders the post-search catalogue and selected identity survives refresh',async({page},info)=>{
 await page.setViewportSize({width:440,height:894});const mock=await isolatedApp(page,{discoverySuccess:true});
 await page.locator('.metadata-accordion summary').click();await page.locator('[data-editions]').click();await page.locator('[data-edition-refresh]').click();
 await expect(page.locator('.edition-row')).toHaveCount(3);expect(mock.discoveryCalls).toBe(1);await expect(page.locator('.edition-error')).toHaveCount(0);await expect(page.locator('.edition-browser-status').last()).toContainText('0 print');
 await page.locator('[data-edition-own="provider-1"]').click();await expect(page.locator('#modal-root')).toBeEmpty();await page.waitForLoadState('networkidle');await page.reload();
 await page.locator('.metadata-accordion summary').click();await page.locator('[data-editions]').click();await expect(page.locator('.edition-row.selected')).toContainText('9780008279493');await expect(page.locator('.edition-current-label')).toHaveText('Current edition');
 await page.screenshot({animations:'disabled',path:`output/playwright/discovery-${info.project.name}.png`});await assertBrowserErrors(page,mock);
});

async function gesture(page,kind='end'){
 await expect(page.locator('#app')).not.toHaveClass(/route-scroll-lock/);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.evaluate(kind=>{const main=document.querySelector('#app main');const touch=(type,x,y)=>{const e=new Event(type,{bubbles:true,cancelable:true});Object.defineProperty(e,'touches',{value:type==='touchend'||type==='touchcancel'?[]:[{clientX:x,clientY:y}]});main.dispatchEvent(e);};touch('touchstart',12,220);touch('touchmove',86,224);if(kind==='end')touch('touchend');if(kind==='cancel')touch('touchcancel');},kind);
}
test('rapid navigation and interrupted/repeated swipes restore vertical scroll',async({page},info)=>{
 await page.setViewportSize({width:440,height:894});const mock=await isolatedApp(page);
 for(let i=0;i<6;i++){
  await gesture(page,i%2?'cancel':'start');await page.locator(`[data-route="${i%2?'wishlist':'library'}"]`).first().click();await expect(page.locator('main')).not.toHaveClass(/swipe-/);
  await page.locator('[data-route="home"]').first().click();await page.locator('[data-route="library"]').first().click();
  await expect(page.locator('#app')).toHaveAttribute('data-route-view','library');await expect(page.locator('#app')).not.toHaveClass(/route-scroll-lock/);await page.evaluate(()=>window.scrollTo(0,500));await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(100);
  await page.evaluate(()=>window.scrollTo(0,0));await page.locator('[data-open-book="yeti"]').first().click();await expect(page.locator('.detail-header')).toBeVisible();
 }
 await gesture(page);await expect(page.locator('#app')).toHaveAttribute('data-route-view','library');await expect(page.locator('main')).not.toHaveClass(/swipe-/);
 await expect(page.locator('#app')).toHaveAttribute('data-route-view','library');await expect(page.locator('#app')).not.toHaveClass(/route-scroll-lock/);await page.evaluate(()=>window.scrollTo(0,500));await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(100);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
 await assertBrowserErrors(page,mock);await page.screenshot({animations:'disabled',path:`output/playwright/navigation-${info.project.name}.png`});
});
