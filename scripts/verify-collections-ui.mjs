// Visual/functional review using the deployed (or local) assets and an isolated
// HTTP backend. No production credentials, Library mutations or private data.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit,expect} from '@playwright/test';
import {fixture} from '../tests/helpers/collection-app.js';
import {collectionArtwork} from '../src/data/collection-artwork.js';

const base=process.env.READING_ROOM_PREVIEW_URL || 'http://127.0.0.1:4173/';
const label=base.startsWith('https:')?'deployed':'local';
const folder=`output/collections/${label}-refinement`;
await mkdir(folder,{recursive:true});
const evidence={base,verified_at:new Date().toISOString(),backend:'isolated HTTP fixtures; no production data writes',artwork:[],checks:[]};
// Confirm every fallback is a real image from its recorded primary source.
const artworkEntries=Object.entries(collectionArtwork);
for(let offset=0;offset<artworkEntries.length;offset+=4) {
 const checked=await Promise.all(artworkEntries.slice(offset,offset+4).map(async([key,art])=>{
  const response=await fetch(art.cover_url);
  assert.equal(response.status,200,`cover: ${key}`);assert.match(response.headers.get('content-type'),/^image\//);
  return {key,source:art.source_url,status:response.status,bytes:(await response.arrayBuffer()).byteLength};
 }));evidence.artwork.push(...checked);
}
for(const [engine,type] of Object.entries({chromium,webkit})) {
 const browser=await type.launch();
 try {
  for(const theme of ['reading-room','terminal']) {
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'});
   const page=await context.newPage();
   const mock=await fixture(page,{theme,backend:false,realArtwork:true,base});
   await page.goto(`${base}#/collections`);
   await expect(page.locator('.collection-card')).toHaveCount(3);
   await expect(page.locator('.collection-card .cover-image').first()).toBeVisible();
   await expect.poll(()=>page.locator('.collection-card .cover-image').first().evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
   await page.screenshot({path:`${folder}/${engine}-${theme}-overview.png`,fullPage:true});
   await page.locator('.collection-card').first().getByRole('link',{name:'Explore collection',exact:true}).click();
   const shelf=page.locator('[data-cover-shelf="collection-hero"]');
   await expect(shelf.locator('.collection-shelf-book')).toHaveCount(31);
   await expect.poll(()=>shelf.locator('img').first().evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
   assert.ok(await shelf.evaluate(n=>n.scrollWidth>n.clientWidth));
   if(engine==='chromium') {
    const bounds=await shelf.boundingBox(),cdp=await context.newCDPSession(page);
    const y=bounds.y+Math.min(bounds.height/2,70),start=bounds.x+bounds.width-16;
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});
    for(let step=1;step<=8;step++) await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start-step*30,y}]});
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await expect.poll(()=>shelf.evaluate(n=>n.scrollLeft)).toBeGreaterThan(40);
    await cdp.detach();
   } else {
    await shelf.focus();await page.keyboard.press('ArrowRight');
    await expect.poll(()=>shelf.evaluate(n=>n.scrollLeft)).toBeGreaterThan(0);
   }
   await shelf.evaluate(n=>{n.scrollLeft=0;n.blur();});
   for(let index=0;index<4;index++) await expect.poll(()=>shelf.locator('img').nth(index).evaluate(n=>n.complete&&n.naturalWidth>0)).toBe(true);
   await page.screenshot({path:`${folder}/${engine}-${theme}-collection.png`});
   await expect(page.locator('[data-path-edit],[data-path-save]')).toHaveCount(0);
   await page.getByRole('button',{name:'Full Collection',exact:true}).click();
   await expect(page.locator('.collection-book')).toHaveCount(31);
   await expect(page.locator('[data-subseries-group] > h2')).toHaveText(['Pendergast','Nora Kelly','Standalone introductions']);
   await page.locator('[data-subseries-group="pendergast"] > h2').scrollIntoViewIfNeeded();
   await page.screenshot({path:`${folder}/${engine}-${theme}-book-rows.png`});
   await page.getByRole('link',{name:'Nora Kelly',exact:true}).click();
   await expect(page.locator('.collection-book')).toHaveCount(6);
   await page.locator('.collection-book h3 a').first().click();
   await expect(page.locator('.collection-catalogue-detail h1')).toHaveText('Old Bones');
   await expect(page.locator('.collection-catalogue-hero').getByRole('button',{name:'Add to library',exact:true})).toBeVisible();
   await page.screenshot({path:`${folder}/${engine}-${theme}-catalogue-book.png`});
   await page.locator('[data-back]').click();await expect(page).toHaveURL(/series=nora-kelly/);
   await page.goto(`${base}#/book/thunder`);
   await expect(page.locator('.visible-metadata')).toBeVisible();
   assert.ok(await page.locator('.visible-metadata').evaluate(n=>n.nextElementSibling.classList.contains('book-collections')));
   await expect(page.locator('.book-collection-membership')).toHaveCount(1);
   await page.locator('.book-collections').scrollIntoViewIfNeeded();
   await page.screenshot({path:`${folder}/${engine}-${theme}-book-collections.png`});
   for(const width of [320,390,430]) {
    await page.setViewportSize({width,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   }
   // Explicit click exercises Wishlist against fixtures only, then canonical navigation.
   await page.goto(`${base}#/book/catalogue%3Apc%3Arelic`);
   await page.locator('.collection-catalogue-hero').getByRole('button',{name:'Add to library',exact:true}).click();
   await expect(page.locator('.detail-header h1')).toHaveText('Relic');
   await expect(page.locator('.detail-header .meta')).toContainText('Wishlist');
   assert.equal(mock.mutations.filter(m=>m.table==='library_add_selected_result').length,1);
   assert.deepEqual(mock.errors,[]);
   evidence.checks.push({engine,theme,viewport:390,overview:true,subseries:true,cover_scrolling:engine==='chromium'?'touch swipe':'keyboard native overflow',back_navigation:true,book_section_placement:true,wishlist_fixture:true,overflow:false,page_errors:0});
   await context.close();
  }
 } finally {await browser.close();}
}
await writeFile(`${folder}/verification.json`,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({base,artwork:evidence.artwork.length,checks:evidence.checks},null,2));
