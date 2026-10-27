import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fixture} from '../helpers/collection-app.js';
import {discoveryDb,finish} from '../helpers/collection-discovery-db.js';
import {owner,bookId} from '../helpers/planner-db.js';
import {registry} from '../../supabase/functions/_shared/collection-registry.js';
import {discoverCollections,discoverWithProviders} from '../../supabase/functions/_shared/collection-discovery.js';
test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
test.setTimeout(90000);

async function serveCatalogue(page,db) {
 await page.route('**/mock-supabase/rest/v1/**',async route=>{
  const table=new URL(route.request().url()).pathname.split('/').at(-1);
  if(!['collections','collection_catalogue_books','collection_memberships','series','book_series'].includes(table)) return route.fallback();
  return route.fulfill({contentType:'application/json',body:JSON.stringify((await db.query(`select * from public.${table}`)).rows)});
 });
}
test('new previously unknown series added through frontend gets a full verified catalogue without additional Wishlist or edition records',async({page})=>{
 await page.clock.install();
 const db=await discoveryDb();
 try {
  await db.query('insert into auth.users(id) values($1)',[owner]);await db.query('update private.app_state set owner_user_id=$1',[owner]);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  for(const f of ['20260908080146_ai_recommendation_shelf.sql','20260908190526_selected_book_immediate_metadata_v2.sql']) await db.exec(await readFile(`supabase/migrations/${f}`,'utf8'));
  let added;
  const mock=await fixture(page,{onSelectedAdd:async p=>{added=(await db.query('select public.library_add_selected_result($1,$2,$3) result',[JSON.stringify(p.p_result),p.p_status,p.p_ownership])).rows[0].result;return added;}});
  const selected={title:'First Voyage',authors:['New Author'],isbn13:'9780306406157',publication_year:2020,provider:'Publisher catalogue',source_url:'https://www.quarto.com/books/first'};
  await page.route('**/functions/v1/book-search',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({results:[selected]})}));
  await page.getByRole('button',{name:'Add book',exact:true}).click();await page.getByLabel('Book title',{exact:true}).fill(selected.title);await page.getByRole('button',{name:'Search',exact:true}).click();
  await page.locator('.add30-result').click();await expect(page.locator('#modal-root')).toBeEmpty();await expect(page.locator('.library-grid')).toContainText(selected.title);
  const b={id:added.book_id,title:selected.title,authors:'New Author',editions:(await db.query('select * from public.editions')).rows};
  const before=JSON.stringify((await db.query("select jsonb_build_object('library',(select jsonb_agg(l) from public.library_entries l),'editions',(select jsonb_agg(e) from public.editions e),'recommendations',(select jsonb_agg(r) from public.recommendations r),'events',(select jsonb_agg(e) from public.library_events e)) data")).rows[0].data);
  const jsonld={'@type':'BookSeries',name:'Voyages of Glass',numberOfItems:2,hasPart:[{'@type':'Book',name:b.title,author:{name:b.authors},position:1,datePublished:'2020-01-01'},{'@type':'Book',name:'Last Voyage',author:{name:b.authors},position:2,datePublished:'2021-01-01'}]};
  const d=await discoverWithProviders(b,{books:[b],book_series:[]},registry,{fetchDocument:async()=>jsonld});
  expect(d.status).toBe('linked');const job=(await db.query('select * from public.claim_collection_discovery(1)')).rows[0];expect(await finish(db,job,d)).toBe(true);
  expect(JSON.stringify((await db.query("select jsonb_build_object('library',(select jsonb_agg(l) from public.library_entries l),'editions',(select jsonb_agg(e) from public.editions e),'recommendations',(select jsonb_agg(r) from public.recommendations r),'events',(select jsonb_agg(e) from public.library_events e)) data")).rows[0].data)).toBe(before);
  expect((await db.query('select count(*)::int n from public.books')).rows[0].n).toBe(1);
  await serveCatalogue(page,db);await page.goto('/#/collections');await expect(page.getByRole('searchbox',{name:'Search collections'})).toBeVisible();
  // The existing visible-page scheduler learns completed backend discovery.
  // No browser reload or explicit Library mutation is needed.
  await page.clock.runFor(30050);await expect(page.locator('.collection-card').filter({hasText:'Voyages of Glass'})).toHaveCount(1);
  const c=(await db.query("select * from public.collections where name='Voyages of Glass'")).rows[0];
  await page.goto(`/#/collection/${encodeURIComponent(c.key)}`);await page.getByRole('button',{name:'Full Collection',exact:true}).click();
  await expect(page.locator('.collection-book')).toHaveCount(2);await expect(page.locator('.collection-book').filter({hasText:'First Voyage'})).toContainText('Wishlist');await expect(page.locator('.collection-book').filter({hasText:'Last Voyage'})).toContainText('Not in Library');
  await expect(page.locator('.collection-book').filter({hasText:'Last Voyage'})).toContainText('2021');expect(mock.errors).toEqual([]);
 }finally{await db.close();}
});

test('completed backend renders full singleton series, official order, publication years, ownership counts and canonical book-page links',async({page})=>{
 const expected={expanse:10,rama:4,'ready-player':2,sand:2,'children-of-time':4,hitchhikers:6,'thursday-murder-club':5,'beacon-23':1};
 const definitions=Object.keys(expected).map(k=>registry.collections.find(c=>c.key===k));
 const books=definitions.map((c,i)=>{const w=registry.works.find(w=>w.key===c.members[0].work_key);return {id:bookId(i+1),title:w.title,authors:w.authors,editions:[],original_publication_year:w.publication_year,ownership_status:'Owned',overall_status:'Read'};});
 const snapshot={books,series:definitions.map((c,i)=>({id:bookId(i+81),name:c.name})),book_series:definitions.map((c,i)=>({book_id:books[i].id,series_id:bookId(i+81),series_order:null}))};
 const db=await discoveryDb(snapshot);
 try {
  for(const b of books){const j=(await db.query('select * from public.claim_collection_discovery(1,$1)',[b.id])).rows[0];await finish(db,j,discoverCollections(b,snapshot,registry));}
  const mock=await fixture(page,{extraBooks:books});await serveCatalogue(page,db);await page.goto('/#/collections');await page.reload();
  await expect(page.locator('.collection-card').filter({hasText:'Beacon 23'})).toHaveCount(0);
  const beacon=books.at(-1),beaconCollection=(await db.query('select key from public.collections where series_id=$1',[snapshot.series.at(-1).id])).rows[0];
  await page.goto(`/#/collection/${encodeURIComponent(beaconCollection.key)}`);await expect(page.locator('.detail-header h1')).toHaveText('Beacon 23');await expect(page).toHaveURL(new RegExp(`#/book/${beacon.id}$`));
  for(const [i,c] of definitions.entries()) {
   if(c.key==='beacon-23') continue;
   const row=(await db.query('select * from public.collections where series_id=$1',[snapshot.series[i].id])).rows[0];
   await page.goto(`/#/collection/${encodeURIComponent(row.key)}`);await page.getByRole('button',{name:'Full Collection',exact:true}).click();
   await expect(page.locator('.collection-book')).toHaveCount(expected[c.key]);await expect(page.locator('.collection-counts')).toContainText('1 owned');await expect(page.locator('.collection-counts')).toContainText('1 read');
   await expect(page.locator('.collection-book').first()).toContainText(books[i].original_publication_year.toString());await expect(page.locator('.collection-book').nth(1)).toContainText('Not in Library');
   await expect(page.locator('.collection-book').first()).toContainText('Series #1');
   await page.route('**/functions/v1/related-books',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({series:{id:row.series_id,name:row.name,current_order:1,total_books:expected[c.key],books:[{kind:'catalogue',book_id:`catalogue:${c.members[1].work_key}`,title:registry.works.find(w=>w.key===c.members[1].work_key).title,authors:books[i].authors,series_order:2}]},author:null})}));
   await page.locator('.collection-book').first().locator('h3 a').click();await expect(page.locator('.detail-header h1')).toHaveText(books[i].title);
   await expect(page.locator('.series-collection-link')).toHaveAttribute('href',`#/collection/${encodeURIComponent(row.key)}`);
  }
  expect(mock.errors).toEqual([]);
 }finally{await db.close();}
});
