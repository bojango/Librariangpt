import {test,expect} from '@playwright/test';
import {fixture} from '../helpers/collection-app.js';
for(const theme of ['reading-room','terminal'])test(`assessments, full synopsis, pending and negative reasoning in ${theme}`,async({page},info)=>{
 const key='crichton:the-lost-world';
 const negative={work_key:key,verdict:'not_recommended',appeal:'Field investigation and an isolated expedition could appeal to your discovery preference.',frustrations:'Creature violence may conflict with your strong aversion to gore.',reasoning:'The investigation has appeal, but the documented violent threat makes this a weaker personal fit.',continuity:'A sequel; continuity value is separate from enjoyment.',confidence:'Medium',assessed_at:'2026-10-26T12:00:00Z',taste_version:'profile-version',evidence:[{source_url:'https://publisher.example/book',detail:'Source-backed expedition premise.'}]};
 const synopsis='A verified factual synopsis with the complete available description. '.repeat(25);
 const mock=await fixture(page,{theme,assessments:[negative],metadata:{[key]:{synopsis}}});
 await page.route('**/mock-supabase/functions/v1/book-search',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({results:[{title:'The Lost World',authors:'Michael Crichton',isbn10:'034540288X',provider:'Fixture source'}]})}));
 await page.goto('/#/collection/jurassic-park');await page.getByRole('button',{name:'Full Collection',exact:true}).click();
 const row=page.locator('.collection-book').filter({hasText:'The Lost World'});await expect(row).toContainText('Not Recommended');await expect(row.locator('.collection-score')).toHaveCount(0);
 await row.getByText('Librarian’s reasoning',{exact:true}).click();await expect(row).toContainText('strong aversion to gore');
 const pending=page.locator('.collection-book').filter({hasText:'Jurassic Park'});await expect(pending).toContainText('Assessment Pending');await pending.getByText('Librarian’s reasoning',{exact:true}).click();await expect(pending).toContainText('Pending:');
 await row.getByRole('link',{name:'The Lost World',exact:true}).click();await expect(page.locator('.collection-catalogue-detail')).toContainText(synopsis.trim());await expect(page.locator('.collection-catalogue-detail')).toContainText('Medium confidence');
 for(const width of [320,390,1024]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:info.outputPath(`assessment-${theme}.png`),fullPage:true});
 await page.getByRole('button',{name:'Add to library',exact:true}).click();await expect.poll(()=>mock.books.some(b=>b.title==='The Lost World')).toBe(true);
 await page.goto('/#/collection/jurassic-park');await page.getByRole('button',{name:'Full Collection',exact:true}).click();await expect(page.locator('.collection-book').filter({hasText:'The Lost World'})).toContainText('Not Recommended');
 expect(mock.mutations.filter(m=>['recommendations','reading_paths','reading_path_entries','collection_assessments'].includes(m.table))).toEqual([]);expect(mock.errors).toEqual([]);
});
