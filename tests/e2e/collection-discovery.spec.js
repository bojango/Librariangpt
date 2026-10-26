import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fixture} from '../helpers/collection-app.js';
import {discoveryDb,finish} from '../helpers/collection-discovery-db.js';
import {owner} from '../helpers/planner-db.js';
import {discoverCollections} from '../../supabase/functions/_shared/collection-discovery.js';
import {registry} from '../../supabase/functions/_shared/collection-registry.js';

test('frontend add queues real SQL discovery and publishes collection links without adding catalogue titles to Wishlist',async({page})=>{
 const db=await discoveryDb();
 try {
  await db.query('insert into auth.users(id) values($1)',[owner]);
  await db.query('update private.app_state set owner_user_id=$1',[owner]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  await db.exec(await readFile('supabase/migrations/20260908080146_ai_recommendation_shelf.sql','utf8'));
  await db.exec(await readFile('supabase/migrations/20260908190526_selected_book_immediate_metadata_v2.sql','utf8'));
  let added;
  const mock=await fixture(page,{onSelectedAdd:async({p_result,p_status,p_ownership})=>{
    added=(await db.query('select public.library_add_selected_result($1,$2,$3) result',[JSON.stringify(p_result),p_status,p_ownership])).rows[0].result;
    return added;
  }});
  await page.goto('/#/collection/preston-child');
  await page.getByRole('button',{name:'Full Collection',exact:true}).click();
  await page.locator('[data-work-key="pc:relic"] h3 a').click();
  await page.locator('.collection-catalogue-hero').getByRole('button',{name:'Add to library',exact:true}).click();
  await expect(page.locator('.detail-header h1')).toHaveText('Relic');
  expect(added.book_id).toBeTruthy();
  const jobs=(await db.query('select * from public.collection_discovery_jobs')).rows;
  expect(jobs).toHaveLength(1);expect(jobs[0].book_id).toBe(added.book_id);expect(jobs[0].status).toBe('queued');
  const before=(await db.query('select * from public.library_entries')).rows;
  const b={id:added.book_id,title:'Relic',authors:'Douglas Preston, Lincoln Child',editions:[]};
  const snapshot={books:[b],series:[],book_series:[]};
  const job=(await db.query('select * from public.claim_collection_discovery(1)')).rows[0];
  expect(await finish(db,job,discoverCollections(b,snapshot,registry))).toBe(true);
  expect((await db.query('select * from public.library_entries')).rows).toEqual(before);
  expect((await db.query('select count(*)::int n from public.books')).rows[0].n).toBe(1);
  expect((await db.query('select count(*)::int n from public.book_series where book_id=$1',[added.book_id])).rows[0].n).toBe(1);
  expect((await db.query('select count(*)::int n from public.collection_catalogue_books')).rows[0].n).toBeGreaterThan(30);
  // Feed the actual migrated catalogue back through the browser's existing API.
  await page.route('**/mock-supabase/rest/v1/collection*',async route=>{
    const table=new URL(route.request().url()).pathname.split('/').at(-1);
    if(!['collections','collection_catalogue_books','collection_memberships'].includes(table)) return route.fallback();
    const result=await db.query(`select * from public.${table}`);
    return route.fulfill({contentType:'application/json',body:JSON.stringify(result.rows)});
  });
  await page.goto('/#/collections');await page.reload();
  await page.goto('/#/collection/preston-child');await page.getByRole('button',{name:'Full Collection',exact:true}).click();
  await expect(page.locator('[data-work-key="pc:relic"]')).toContainText('Wishlist');
  await expect(page.locator('[data-work-key="pc:reliquary"]')).toContainText('Not in Library');
  expect(mock.books.filter(b=>b.title==='Relic')).toHaveLength(1);expect(mock.errors).toEqual([]);
 } finally {await db.close();}
});
