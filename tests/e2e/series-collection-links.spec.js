import {test,expect} from '@playwright/test';
import {fixture} from '../helpers/collection-app.js';

test.use({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
const buttonStyle=node=>{
 const style=getComputedStyle(node);
 return Object.fromEntries(['borderRadius','paddingTop','paddingRight','paddingBottom','paddingLeft','fontSize','fontWeight','fontFamily','lineHeight','letterSpacing','boxShadow'].map(key=>[key,style[key]]));
};

for(const theme of ['reading-room','terminal']) {
 test(`existing Bobiverse and Jurassic Park shelves link by ID and preserve interactions in ${theme}`,async({page},info)=>{
  const mock=await fixture(page,{theme,related:true,backend:false});
  for(const [book,heading,href,titles,author] of [
   ['bob','Bobiverse','#/collection/series%3Abob-series',['For We Are Many','All These Worlds','The Bobiverse'],'More by Dennis E. Taylor'],
   ['jurassic','Jurassic Park','#/collection/jurassic-park',['The Lost World'],'More by Michael Crichton']
  ]) {
   await page.goto(`/#/book/${book}`);
   await expect(page.locator('.book-collections')).toHaveCount(0);
   const section=page.locator('related-books > section').first(),link=section.getByRole('link',{name:heading,exact:true});
   await expect(link).toHaveAttribute('href',href);
   await expect(section.locator('.book-title')).toHaveText(titles);
   const authorSection=page.locator('related-books > section').nth(1);
   await expect(authorSection.getByRole('heading',{name:author,exact:true})).toBeVisible();
   const appearance=await link.evaluate(n=>{
    const own=getComputedStyle(n),heading=getComputedStyle(n.parentElement);
    return {own:[own.fontFamily,own.fontSize,own.fontWeight,own.color,own.letterSpacing],heading:[heading.fontFamily,heading.fontSize,heading.fontWeight,heading.color,heading.letterSpacing],decoration:own.textDecorationLine};
   });
   expect(appearance.own).toEqual(appearance.heading);expect(appearance.decoration).toBe('none');
   await link.click();await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$'));
   await expect(page.locator('.collection-detail h1')).toHaveText(heading);
   await page.locator('[data-collection-back]').click();
   await expect(page.locator('.detail-header')).toHaveAttribute('data-book-id',book);
   await expect(section.locator('.book-title')).toHaveText(titles);
   await authorSection.locator('.book-card').press('Enter');
   await expect(page.locator('.recommended-detail-backdrop h2')).toHaveText(book==='bob'?'The Singularity Trap':'Sphere');
   await page.locator('.recommended-detail-backdrop [data-close]').click();
   if(book==='bob') {
    await expect(section.locator('.book-card').first().locator('.cover-image')).toHaveAttribute('src','/icons/icon-192.png');
    await section.locator('[data-open-book="bob-2"]').click();
    await expect(page.locator('.detail-header h1')).toHaveText('For We Are Many');
    await page.locator('[data-back]').click();await expect(page.locator('.detail-header')).toHaveAttribute('data-book-id','bob');
   }
   await section.locator('[data-related-external]').last().click();
   await expect(page.locator('.recommended-detail-backdrop h2')).toHaveText(titles.at(-1));
   await page.locator('.recommended-detail-backdrop [data-close]').click();
   await section.scrollIntoViewIfNeeded();
   await page.screenshot({path:info.outputPath(`${book}-existing-shelves-${theme}.png`)});
  }
  await page.goto('/#/book/thunder');
  await expect(page.locator('.book-collections')).toHaveCount(0);
  await expect(page.locator('related-books > section')).toHaveCount(1);
  await expect(page.locator('related-books h2')).toHaveText('More by Douglas Preston');
  await page.locator('related-books [data-related-external]').click();
  await expect(page.locator('.recommended-detail-backdrop h2')).toHaveText('Relic');
  await page.locator('.recommended-detail-backdrop [data-close]').click();
  expect(mock.errors).toEqual([]);
  expect(mock.mutations.filter(m=>!['refresh_up_next','related-books','book-background-enrich'].includes(m.table))).toEqual([]);
 });

 test(`collection card buttons reuse homepage progress sizing and effects in ${theme}`,async({page})=>{
  await fixture(page,{theme});
  for(const width of [390,1024]) {
   await page.setViewportSize({width,height:844});await page.goto('/#/home');
   const home=await page.locator('.hero-actions [data-progress]').first().evaluate(buttonStyle);
   await page.goto('/#/collections');
   const cards=page.locator('.collection-card .collection-explore');
   await expect(cards).toHaveCount(3);
   for(const card of await cards.all()) {
    expect(await card.evaluate(buttonStyle)).toEqual(home);
    expect(await card.evaluate(n=>parseFloat(getComputedStyle(n).borderRadius))).toBeLessThan(30);
   }
   await cards.first().focus();await page.keyboard.press('Enter');
   await expect(page.locator('.collection-detail h1')).toHaveText('Preston–Child');
   await page.locator('[data-collection-back]').click();await expect(page.locator('.collection-card')).toHaveCount(3);
  }
 });
}

test('a familiar heading with an unmatched series ID stays ordinary text',async({page})=>{
 await fixture(page,{related:true,unmatchedSeries:true});await page.goto('/#/book/jurassic');
 await expect(page.locator('related-books h2').first()).toHaveText('Jurassic Park');
 await expect(page.locator('related-books h2 a')).toHaveCount(0);
 await expect(page.locator('related-books > section').nth(1).getByRole('heading',{name:'More by Michael Crichton'})).toBeVisible();
});
