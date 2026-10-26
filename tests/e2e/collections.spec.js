import {test,expect} from '@playwright/test';
import {collectionArtwork} from '../../src/data/collection-artwork.js';
import {fixture} from '../helpers/collection-app.js';

test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});

for(const theme of ['reading-room','terminal']) test(`three collection screens, canonical status and catalogue-only navigation in ${theme}`,async({page},info)=>{
 const mock=await fixture(page,{theme});
 await page.getByRole('link',{name:'Collections',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Collections',exact:true,level:1})).toBeVisible();
 await expect(page.locator('.collection-card')).toHaveCount(3);
 await page.screenshot({path:info.outputPath(`collections-overview-${theme}.png`),fullPage:true});
 await expect(page.locator('.bottom-nav .nav-btn')).toHaveCount(4);
 await page.getByRole('searchbox',{name:'Search collections'}).fill('Nora');
 await expect(page.locator('.collection-card')).toHaveCount(1);
 await page.getByRole('searchbox',{name:'Search collections'}).fill('nothing matches');
 await expect(page.getByRole('heading',{name:'No matching collections'})).toBeVisible();
 await page.getByRole('searchbox',{name:'Search collections'}).fill('');
 await page.locator('.collection-card').filter({has:page.getByRole('heading',{name:'Preston–Child',exact:true})}).getByRole('link',{name:'Explore collection',exact:true}).click();
 await expect(page.locator('.collection-explanation')).toContainText('Based on your existing recommendations');
 await expect(page.locator('.collection-book')).toHaveCount(1);
 await page.locator('.collection-book h3 a').click();
 await expect(page.locator('.detail-header')).toBeVisible();
 await expect(page.locator('.book-collections')).toHaveCount(0);
 await expect(page.locator('related-books')).toHaveCount(1);
 await page.screenshot({path:info.outputPath(`book-detail-${theme}.png`),fullPage:true});
 await page.locator('[data-back]').click();
 await expect(page.locator('.collection-detail h1')).toHaveText('Preston–Child');
 await page.getByRole('link',{name:'Character appearances',exact:true}).click();
 await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 await expect(page.locator('.collection-book')).toHaveCount(13);
 await expect(page.locator('.collection-book').filter({hasText:'Old Bones'})).toContainText('Not in Library');
 await expect(page.locator('.collection-book').filter({hasText:'Dead Man’s Journey'})).toContainText('2027');
 await expect(page.locator('.collection-book').filter({hasText:'Dead Man’s Journey'})).toContainText('Forthcoming');
 await page.locator('.collection-book h3 a').filter({hasText:'Old Bones'}).click();
 await expect(page.locator('.collection-catalogue-detail h1')).toHaveText('Old Bones');
 await expect(page.locator('[data-start],[data-finish],[data-collection-status]')).toHaveCount(0);
 await page.locator('[data-back]').click();await expect(page).toHaveURL(/series=nora-corrie/);
 await page.goBack();await expect(page).not.toHaveURL(/series=/);
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
 await expect(page.locator('.collection-book-order')).toHaveText(['Path 1 · 1995 · Series #2','Path 2 · 1990 · Series #1']);
 await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 await expect(page.locator('.collection-book h3')).toHaveText(['Jurassic Park','The Lost World']);
 await expect(page.locator('.collection-book-order')).toHaveText(['1990 · Series #1','1995 · Series #2']);
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
 await expect(page.locator('[data-path-edit],[data-path-save],.path-actions')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Suggested Reads',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 await expect(page.locator('.collection-book')).toHaveCount(3);
 expect(mock.errors).toEqual([]);
});


test('overview author toggle, embossed cards and consolidated subseries navigation',async({page})=>{
 await fixture(page);await page.goto('/#/collections');
 await expect(page.getByText('Your reading, connected',{exact:true})).toHaveCount(0);
 await expect(page.locator('.collection-card')).toHaveCount(3);
 await expect(page.locator('.collection-card .collection-explore')).toHaveCount(3);
 const style=await page.locator('.collection-card').first().evaluate(n=>({radius:parseFloat(getComputedStyle(n).borderRadius),shadow:getComputedStyle(n).boxShadow}));
 expect(style.radius).toBeGreaterThanOrEqual(18);expect(style.shadow).toContain('inset');
 await page.getByRole('checkbox',{name:'Include author collections'}).check();
 await expect(page.locator('.collection-card')).toHaveCount(4);
 const author=page.locator('.collection-card').filter({has:page.getByRole('heading',{name:'Michael Crichton',exact:true})});
 await expect(author).toContainText('Author collection');
 await author.getByRole('link',{name:'Explore collection',exact:true}).click();
 await expect(page.locator('.collection-heading')).toContainText('not an official series');
 await expect(page.locator('[data-path-edit]')).toHaveCount(0);
 await page.goto('/#/collection/preston-child');await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 await expect(page.locator('[data-subseries-group] > h2')).toHaveText(['Pendergast','Nora Kelly','Standalone introductions']);
 await expect(page.locator('.collection-book')).toHaveCount(31);
 await expect(page.locator('.collection-heading')).toContainText('30 published titles');
 await expect(page.locator('.collection-heading')).toContainText('1 forthcoming');
 await expect(page.locator('.collection-statuses').getByText('Recommended',{exact:true})).toHaveCount(0);
 await expect(page.locator('[data-work-key="pc:dead-mans-journey"]')).toContainText('Forthcoming');
 await page.getByRole('link',{name:'Nora Kelly',exact:true}).click();
 await expect(page.locator('.collection-book')).toHaveCount(6);
 await expect(page.locator('.collection-book-order').first()).toHaveText('2019 · Nora Kelly #1');
 await page.getByRole('link',{name:'Pendergast',exact:true}).click();
 await expect(page.locator('.collection-book').first()).toContainText('Relic');
 await expect(page.locator('.collection-book-order').first()).toHaveText('1995 · Pendergast #1');
});

for(const theme of ['reading-room','terminal']) test(`native cover shelves, safe areas and menu clearance in ${theme}`,async({page},info)=>{
 const mock=await fixture(page,{theme});await page.goto('/#/collection/preston-child');
 const shelf=page.locator('[data-cover-shelf="collection-hero"]');
 await expect(shelf.locator('.collection-shelf-book')).toHaveCount(31);
 const geometry=await shelf.evaluate(n=>{const r=n.getBoundingClientRect(),a=n.firstElementChild.getBoundingClientRect();return {width:r.width,cover:a.width,overflow:n.scrollWidth>n.clientWidth,above:n.nextElementSibling.classList.contains('collection-heading')};});
 expect(geometry.width/geometry.cover).toBeGreaterThan(4);expect(geometry.width/geometry.cover).toBeLessThan(5.5);expect(geometry.overflow).toBe(true);expect(geometry.above).toBe(true);
 await shelf.focus();await page.keyboard.press('ArrowRight');
 await expect.poll(()=>shelf.evaluate(n=>n.scrollLeft)).toBeGreaterThan(0);
 await shelf.evaluate(n=>n.scrollLeft=n.scrollWidth);await expect.poll(()=>shelf.evaluate(n=>n.scrollLeft)).toBeGreaterThan(500);
 await shelf.locator('a').last().click();await expect(page.locator('.collection-catalogue-detail h1')).toHaveText('Dead Man’s Journey');
 await page.locator('[data-back]').click();
 await page.getByRole('button',{name:'Open menu',exact:true}).click();
 await expect(page.locator('.sidebar-panel')).toBeVisible();
 await page.getByRole('button',{name:'Close menu',exact:true}).click();
 await expect(page.locator('.sidebar-panel')).toHaveCount(0);
 await page.goto('/#/collection/jurassic-park');
 await expect(page.locator('.collection-cover-shelf')).toHaveClass(/shelf-centred/);
 expect(await page.locator('.collection-cover-shelf').evaluate(n=>getComputedStyle(n).justifyContent)).toBe('center');
 await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 for(const width of [320,390,430]) {
  await page.setViewportSize({width,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{document.documentElement.style.setProperty('--safe-left','44px');document.documentElement.style.setProperty('--safe-right','36px');document.documentElement.style.setProperty('--safe-bottom','34px');});
 const gutters=await page.locator('main').evaluate(n=>({left:parseFloat(getComputedStyle(n).paddingLeft),right:parseFloat(getComputedStyle(n).paddingRight)}));
 expect(gutters.left).toBeGreaterThanOrEqual(44);expect(gutters.right).toBeGreaterThanOrEqual(36);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('.collection-book').last().locator('button').scrollIntoViewIfNeeded();
 const button=await page.locator('.collection-book').last().locator('button').boundingBox(),nav=await page.locator('.bottom-nav').boundingBox();
 expect(button.y+button.height).toBeLessThan(nav.y);
 await page.screenshot({path:info.outputPath(`shelf-safe-areas-${theme}.png`),fullPage:true});
 expect(mock.errors).toEqual([]);
});

test('catalogue-only Add to library creates Wishlist once and navigates to the canonical book',async({page})=>{
 const mock=await fixture(page,{backend:false});
 await page.goto('/#/collection/preston-child');
 await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 await page.locator('[data-work-key="pc:relic"] h3 a').click();
 await expect(page.locator('.collection-catalogue-hero .cover-image')).toHaveAttribute('src',collectionArtwork['pc:relic'].cover_url);
 await page.locator('.collection-catalogue-hero').getByRole('button',{name:'Add to library',exact:true}).dblclick();
 await expect(page.locator('.detail-header h1')).toHaveText('Relic');
 await expect(page.locator('.detail-header .meta')).toContainText('Wishlist');
 await expect(page).toHaveURL(/#\/book\/new-2$/);
 await page.locator('[data-back]').click();
 await expect(page).toHaveURL(/#\/collection\/preston-child$/);
 const row=page.locator('[data-work-key="pc:relic"]');await expect(row).toContainText('Wishlist');
 await expect(row.getByRole('button',{name:'Add to library',exact:true})).toHaveCount(0);
 const adds=mock.mutations.filter(m=>m.table==='library_add_selected_result');expect(adds).toHaveLength(1);
 expect(adds[0].body.p_result.cover_url).toBeUndefined();expect(mock.books.filter(b=>b.title==='Relic')).toHaveLength(1);
 expect(mock.books.find(b=>b.id==='thunder').overall_status).toBe('Currently Reading');
 expect(mock.books.find(b=>b.id==='jurassic').overall_status).toBe('Read');expect(mock.errors).toEqual([]);
});

for(const race of [false,true]) test(`canonical catalogue Wishlist insert preserves ${race?'concurrent Read status and selected cover':'identity without duplicate creation'}`,async({page})=>{
 const mock=await fixture(page,{canonicalOnly:true,race});
 await page.goto('/#/collection/preston-child');await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 const row=page.locator('[data-work-key="pc:relic"]');await row.getByRole('button',{name:'Add to library',exact:true}).click();
 await expect(row.locator('.collection-statuses')).toContainText(race?'Read':'Wishlist');
 const adds=mock.mutations.filter(m=>m.table==='library_entries');expect(adds).toHaveLength(1);
 expect(adds[0].headers.prefer).toContain('resolution=ignore-duplicates');
 expect(mock.mutations.filter(m=>m.table==='library_add_selected_result')).toHaveLength(0);
 expect(mock.books.filter(b=>b.title==='Relic')).toHaveLength(1);
 if(race) {expect(mock.books.find(b=>b.id==='relic').cover_url).toBe('https://selected-edition.test/relic.jpg');expect(mock.books.find(b=>b.id==='relic').ownership_status).toBe('Owned');}
 expect(mock.errors).toEqual([]);
});
