import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Exercise the shipped bundle and handlers with isolated, mutable HTTP fixtures.
// Every Supabase request is intercepted; these tests never write real library data.
async function isolatedProfile(page, { theme = 'reading-room', feedError = false, feedDelay = 0 } = {}) {
  const user = { id:'10000000-0000-0000-0000-000000000001',aud:'authenticated',role:'authenticated',user_metadata:{full_name:'Calum'} };
  const jwt = [{alg:'HS256',typ:'JWT'},{sub:user.id,role:'authenticated',aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.test';
  await page.addInitScript(({user,jwt,theme}) => {
    localStorage.setItem('sb-127-auth-token',JSON.stringify({access_token:jwt,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,user}));
    localStorage.setItem('reading-room-theme',theme);
  },{user,jwt,theme});
  const book = { id:'20000000-0000-0000-0000-000000000001',title:'Gateway',authors:'Frederik Pohl',overall_status:'Read',user_rating_5:3.8,ownership_status:'Owned',primary_genre:'Science Fiction',total_pages:280,started_at:'2026-01-01',completed_at:'2026-01-05',cover_url:'/icons/icon-192.png',synopsis:'A test book.' };
  const current = {...book,id:'20000000-0000-0000-0000-000000000002',title:'Thunderhead',overall_status:'Currently Reading',current_page:40,completed_at:null,user_rating_5:null};
  let profile = {display_name:'Calum',handle:'@calum',library_name:'Alder Creek Library',short_bio:'An obsolete biography.',avatar_path:null};
  let quotes = []; let avatarUploads = 0; let failFeed = feedError;
  const signals = [{id:'signal',dimension:'Discovery',preference:'Enjoys exploring unfamiliar worlds through gradual discovery, with a clear sense of progression and grounded explanations. Prefers stories whose secrets reward close attention.',direction:'Positive',strength:'Strong',confidence:'High',evidence_count:4,last_updated:'2026-10-10',taste_evidence:[{book_id:book.id,relation:'supports',weight:1,book}]}];
  const events = Array.from({length:25},(_,i)=>({id:`40000000-0000-0000-0000-${String(100-i).padStart(12,'0')}`,event_type:i===1?'librarian':i%2?'wishlist':'started',source:'system',occurred_at:new Date(Date.now()-(i+1)*3600000).toISOString(),book_id:current.id,metadata:{},hashtags:[i===1?'librarian':i%2?'wishlist':'started'],content:i===1?'A reading reflection.':null}));
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('https://**/*',route=>route.abort());
  await page.route('**/dist/app.js?*',route=>route.fulfill({contentType:'application/javascript',body:readFileSync('dist/app.js','utf8').replaceAll('https://fbbpovieqfsjunmqtxvf.supabase.co','http://127.0.0.1:4173/mock-supabase')}));
  await page.route('**/mock-supabase/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path=url.pathname.replace('/mock-supabase','');
    const json = (value,status=200) => route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
    if (path==='/auth/v1/user') return json(user);
    if (path.startsWith('/storage/v1/object/sign/reader-avatars')) return json({signedURL:'/storage/v1/object/sign/reader-avatars/avatar.png?token=test'});
    if (path.startsWith('/storage/v1/object/reader-avatars')) { avatarUploads++; return json({Key:'avatar.png'}); }
    if (path.includes('/rest/v1/reader_profiles')) {
      if (request.method()==='POST') { profile={...profile,...request.postDataJSON()}; return json(profile); }
      return json(profile);
    }
    if (path.includes('/rest/v1/activity_events')) {
      if(feedDelay) await new Promise(resolve=>setTimeout(resolve,feedDelay));
      if(failFeed) return json({message:'Fixture offline'},503);
      let selected=[...events].sort((a,b)=>Date.parse(b.occurred_at)-Date.parse(a.occurred_at)||b.id.localeCompare(a.id));
      const filter=url.searchParams.get('event_type');
      if(filter?.startsWith('eq.')) selected=selected.filter(e=>e.event_type===filter.slice(3));
      if(filter?.startsWith('in.')) selected=selected.filter(e=>filter.includes(e.event_type));
      const tags=url.searchParams.get('hashtags'); if(tags) selected=selected.filter(e=>e.hashtags.some(tag=>tags.includes(tag)));
      const cursor=url.searchParams.get('or')?.match(/occurred_at.lt.([^,]+),and/);
      if(cursor) selected=selected.filter(e=>Date.parse(e.occurred_at)<Date.parse(cursor[1]));
      return json(selected.slice(0,Number(url.searchParams.get('limit')||20)));
    }
    if(path.includes('/rest/v1/v_library')) return json(url.searchParams.has('id') ? [book,current].find(b=>url.searchParams.get('id')===`eq.${b.id}`) : [book,current,{...book,id:'wish',overall_status:'Wishlist'}]);
    if(path.includes('/rest/v1/taste_profile')) return json(signals);
    if(path.includes('/rest/v1/reading_sessions')) {
      const completed=[{id:'one',book_id:book.id,status:'Completed',total_pages:280,current_page:280,started_at:'2026-01-01',completed_at:'2026-01-05',user_rating_5:3.8},{id:'two',book_id:book.id,status:'Completed',total_pages:280,current_page:280,started_at:'2026-03-01',completed_at:'2026-03-03',user_rating_5:4}];
      return json(url.searchParams.get('status') ? completed : url.searchParams.get('select')?.includes('current_page') ? [...completed,{id:'current',book_id:current.id,status:'Reading',total_pages:280,current_page:40}] : null);
    }
    if(path.includes('/rest/v1/book_quotes')) {
      if(request.method()==='POST') {
        const payload=request.postDataJSON(); const found=quotes.find(q=>q.id===payload.id);
        if(found) Object.assign(found,payload); else quotes.push({...payload,created_at:new Date().toISOString()});
        if(!events.some(e=>e.quote_id===payload.id)) events.unshift({id:'50000000-0000-0000-0000-000000000001',event_type:'quotes',quote_id:payload.id,book_id:payload.book_id,metadata:payload,occurred_at:new Date().toISOString(),hashtags:['quotes']});
        return json(null);
      }
      if(request.method()==='PATCH') {
        const id=url.searchParams.get('id').slice(3);const payload=request.postDataJSON();Object.assign(quotes.find(q=>q.id===id),payload);Object.assign(events.find(e=>e.quote_id===id).metadata,payload);return json(null);
      }
      return json(quotes);
    }
    if(path.includes('/rest/v1/reading_time_sessions')) return json([{id:'time',book_id:book.id,started_at:'2026-01-01T10:00:00Z',ended_at:'2026-01-01T11:00:00Z',session_kind:'reading'}]);
    if(path.includes('/rest/v1/books')) return json({metadata_status:'complete'});
    if(path.includes('/rest/v1/rpc/')) return json(null);
    return json([]);
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto('/#/profile'); await expect(page.locator('.profile-card')).toBeVisible();
  return {events,errors,quotes,signals,get uploads(){return avatarUploads;},recover(){failFeed=false;},profile:()=>profile};
}

test('iPhone profile feed, timestamp, filters, pagination, all tabs and back navigation', async ({page},info) => {
  const mock=await isolatedProfile(page);
  await expect(page.getByRole('tab',{name:'Feed',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.activity-card')).toHaveCount(20);
  await expect(page.locator('.profile-inline-identity')).toHaveText('@calum');
  await expect(page.locator('.profile-genres')).toHaveText('Sci-Fi');
  await expect(page.locator('.profile-card-stats strong')).toHaveText(['1','600','1']);
  await expect(page.locator('.profile-card-stats span')).toHaveText(['Books Read','Pages Read','Wishlist']);
  await expect(page.locator('[data-profile-edit],.profile-avatar-action-icon,.terminal-profile-upload')).toHaveCount(0);
  await expect(page.locator('[data-expand="profile-summary"]')).toHaveAttribute('aria-expanded','false');
  await page.locator('[data-expand="profile-summary"]').click(); await expect(page.locator('[data-expand="profile-summary"]')).toHaveText('See less');
  const stamp=page.locator('.activity-time').first(); const exact=await stamp.getAttribute('data-exact-time');await stamp.click();await expect(stamp).toHaveText(exact);
  await page.locator('[data-feed-more]').click();await expect(page.locator('.activity-card')).toHaveCount(25);
  const ids=await page.locator('.activity-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.activityId));expect(new Set(ids).size).toBe(25);
  await page.locator('.activity-tags [data-feed-filter="wishlist"]').first().click();
  await expect(page.locator('.feed-filters [data-feed-filter="wishlist"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.activity-card')).toHaveCount(11);
  await page.locator('.feed-filters [data-feed-filter="librarian"]').click();await expect(page.locator('.activity-meta strong')).toHaveText('Librarian');
  await page.locator('.feed-filters [data-feed-filter="quotes"]').click();await expect(page.locator('.feed-state')).toContainText('No activity here yet');
  await page.locator('.feed-filters [data-feed-filter="all"]').click();
  await page.getByRole('tab',{name:'Stats',exact:true}).click();await expect(page.locator('.profile-stat-record')).toContainText('TOTAL READING TIME');await expect(page.locator('.profile-stat-row').last()).toContainText('1h');
  await page.getByRole('tab',{name:'Stats',exact:true}).press('ArrowRight');await expect(page.getByRole('tab',{name:'Taste Details'})).toBeFocused();
  await expect(page.locator('.taste-details-sections')).toContainText('Emerging Signals');await expect(page.locator('.taste-book-evidence')).toContainText('Gateway');
  await page.getByRole('tab',{name:'History',exact:true}).click();await expect(page.locator('.history-year h3')).toHaveText('2026');await expect(page.locator('.profile-history-item')).toHaveCount(2);await expect(page.locator('.profile-history-list')).toContainText('4 days');
  await page.locator('.profile-history-item').first().click();await expect(page.locator('.detail-header')).toBeVisible();await page.locator('[data-back]').click();await expect(page.getByRole('tab',{name:'History',exact:true})).toHaveAttribute('aria-selected','true');
  await page.locator('[data-route="home"]').last().click();await page.locator('[data-route="profile"]').last().click();await expect(page.getByRole('tab',{name:'Feed',exact:true})).toHaveAttribute('aria-selected','true');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({path:info.outputPath('profile-feed-iphone.png'),fullPage:true});expect(mock.errors).toEqual([]);
});

test('inline identity save/cancel, avatar replacement and menu NFC relocation', async ({page}) => {
  const mock=await isolatedProfile(page);
  await page.locator('[data-identity-edit]').click();await expect(page.locator('.profile-inline-form input[name="handle"]')).toBeFocused();
  await page.locator('.profile-inline-form input[name="handle"]').fill('@cancelled');await page.locator('.profile-inline-form input[name="handle"]').press('Escape');await expect(page.locator('[data-identity-edit]')).toHaveText('@calum');
  await page.locator('[data-identity-edit]').click();await page.locator('.profile-inline-form input[name="handle"]').fill('@new-reader');await page.locator('.profile-inline-form input[name="displayName"]').fill('New Reader');await page.locator('.profile-inline-form button[type="submit"]').click();await expect(page.locator('[data-identity-edit]')).toHaveText('@new-reader');expect(mock.profile().display_name).toBe('New Reader');
  await expect(page.locator('.activity-meta strong').first()).toHaveText('@new-reader');await expect(page.locator('.feed-prose').first()).toContainText('@new-reader');
  await page.locator('[data-avatar-menu]').click();await page.locator('[data-avatar-change]').click();await page.locator('[data-avatar-input]').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:readFileSync('icons/icon-192.png')});await expect(page.locator('#toast')).toHaveText('Profile photo updated.');expect(mock.uploads).toBe(1);
  for(const tab of ['Feed','Stats','Taste Details','History']) {await page.getByRole('tab',{name:tab,exact:true}).click();await expect(page.locator('.profile-page')).not.toContainText('NFC Bookmark');}
  await page.locator('[data-menu]').click();await page.locator('.nfc-menu-section summary').click();await page.locator('[data-side-nfc]').click();await expect(page.getByRole('heading',{name:'NFC Bookmark',exact:true})).toBeVisible();expect(mock.errors).toEqual([]);
});

test('quotes saved and edited through existing controls appear once with exact text', async ({page}) => {
  const mock=await isolatedProfile(page);await page.locator('.activity-book').first().click();
  await page.locator('[data-quote-add]').click();const text='  A saved line.\n\n<em>Exact quotation</em>\nLast line.  ';
  await page.locator('#quote-text-v40').fill(text);await page.locator('#quote-page-start-v40').fill('12');await page.locator('#quote-page-end-v40').fill('14');await page.locator('#quote-chapter-v40').fill('Three');await page.locator('#quote-note-v40').fill('Personal note');await page.getByRole('button',{name:'Save quote',exact:true}).click();await expect(page.locator('#toast')).toHaveText('Quote saved.');expect(mock.quotes[0].quote_text).toBe(text);
  await expect(page.locator('[data-quote-edit]')).toHaveCount(1);await page.locator('[data-quote-edit]').click();await page.locator('#quote-text-v40').fill(text+'\nEdited');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('#toast')).toHaveText('Quote updated.');
  await page.locator('[data-back]').click();await page.locator('.feed-filters [data-feed-filter="quotes"]').click();await expect(page.locator('.activity-card')).toHaveCount(1);await expect(page.locator('.feed-quotation')).toHaveText(text+'\nEdited');await expect(page.locator('.activity-book')).toContainText('p. 12–14 · Chapter Three');await expect(page.locator('.activity-card em')).toHaveCount(0);expect(mock.errors).toEqual([]);
});

test('feed failure is independent of profile, supports retry and terminal skin', async ({page},info) => {
  const mock=await isolatedProfile(page,{feedError:true,theme:'terminal'});
  await expect(page.locator('[data-feed-retry]')).toBeVisible();await expect(page.locator('[data-identity-edit]')).toBeVisible();
  await page.getByRole('tab',{name:'Stats',exact:true}).click();await expect(page.locator('.profile-stat-record')).toBeVisible();await page.getByRole('tab',{name:'Feed',exact:true}).click();
  await expect(page.locator('[data-feed-retry]')).toBeVisible();mock.recover();await page.locator('[data-feed-retry]').click();await expect(page.locator('.activity-card')).toHaveCount(20);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({path:info.outputPath('profile-terminal.png')});expect(mock.errors).toEqual([]);
});

test('new external activity refreshes, long multiline passages expand and long usernames wrap', async ({page}) => {
  const mock=await isolatedProfile(page);
  const passage='A preserved multiline quotation.\n\n'.repeat(25);
  mock.events.unshift({id:'60000000-0000-0000-0000-000000000001',event_type:'quotes',book_id:mock.events[0].book_id,occurred_at:new Date().toISOString(),metadata:{quote_text:passage},hashtags:['quotes']});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('reading-room:refresh')));
  await expect(page.locator('.feed-quotation')).toBeVisible();
  const expand=page.locator('.activity-card').first().locator('[data-expand]');await expect(expand).toHaveAttribute('aria-expanded','false');await expand.click();await expect(expand).toHaveText('See less');await expect(page.locator('.feed-quotation')).toHaveText(passage);
  await page.locator('[data-identity-edit]').click();await page.locator('.profile-inline-form input[name="handle"]').fill('@'+'long_username'.repeat(6));await page.locator('.profile-inline-form button[type="submit"]').click();await expect(page.locator('.profile-inline-form')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
});

for (const theme of ['reading-room','terminal']) test(`profile polish aligns at iPhone widths in ${theme}`, async ({page},info) => {
  const mock=await isolatedProfile(page,{theme});
  const supportingBook=mock.signals[0].taste_evidence[0].book;
  mock.signals[0].taste_evidence=['Hard Science Fiction / Techno-thriller','Science Fiction','Adventure Thriller','Travel / Nature','Historical Mystery'].map((genre,i)=>({book_id:`genre-${i}`,relation:'supports',book:{...supportingBook,id:`genre-${i}`,primary_genre:genre}}));
  mock.signals.push({...mock.signals[0],id:'science',dimension:'Science / Technical',preference:'Strongly prefers science with clear explanations, especially when it supports the plot and gives the ideas enough room to make sense.'});
  mock.signals.push({...mock.signals[0],id:'horror',dimension:'Horror',direction:'Negative',confidence:'Medium',preference:'Strong aversion to disturbing imagery. Psychological tension can work when it serves a compelling mystery.'});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('reading-room:refresh')));
  await expect(page.locator('.profile-genres')).toHaveText('Sci-Fi / Thriller / Adventure / Mystery / Nonfiction');
  const collapsedText=await page.locator('#profile-summary').textContent();
  expect(collapsedText).not.toMatch(/Strongly|…|\.\.\./);expect(collapsedText).toContain('enough room to make sense.');
  for (const width of [320,375,390,430]) {
    await page.setViewportSize({width,height:844});
    const layout=await page.locator('.profile-card').evaluate(card=>{
      const rect=selector=>card.querySelector(selector).getBoundingClientRect();
      const photo=rect('.profile-avatar'),badge=rect('.profile-private'),genres=rect('.profile-genres'),bio=rect('.profile-bio'),heading=rect('.profile-inline-identity'),library=rect('.profile-library-name');
      const stats=[...card.querySelectorAll('.profile-card-stats > div')].map(column=>{
        const c=column.getBoundingClientRect();return {width:c.width,center:c.x+c.width/2,children:[...column.children].map(x=>{const r=x.getBoundingClientRect();return {center:r.x+r.width/2,top:r.top};})};
      });
      return {photoWidth:photo.width,topGap:badge.top-photo.top,bottomGap:genres.bottom-photo.bottom,identityCenterGap:(heading.top+library.bottom)/2-(badge.bottom+genres.top)/2,clampHeight:bio.height,lineHeight:parseFloat(getComputedStyle(card.querySelector('.profile-bio')).lineHeight),stats,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
    });
    expect(layout.photoWidth).toBeGreaterThanOrEqual(100);expect(Math.abs(layout.topGap)).toBeLessThanOrEqual(1);expect(Math.abs(layout.bottomGap)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.identityCenterGap)).toBeLessThanOrEqual(1);
    expect(layout.clampHeight).toBeLessThanOrEqual(layout.lineHeight*3+1);expect(layout.overflow).toBe(false);
    expect(Math.max(...layout.stats.map(x=>x.width))-Math.min(...layout.stats.map(x=>x.width))).toBeLessThan(1);
    for (const column of layout.stats) for (const child of column.children) expect(Math.abs(column.center-child.center)).toBeLessThan(1);
    expect(Math.max(...layout.stats.map(x=>x.children[0].top))-Math.min(...layout.stats.map(x=>x.children[0].top))).toBeLessThan(1);
    await page.screenshot({path:info.outputPath(`profile-polish-${theme}-${width}.png`)});
  }
  await page.locator('[data-expand="profile-summary"]').click();await expect(page.locator('#profile-summary')).not.toHaveClass(/is-collapsed/);await expect(page.locator('#profile-summary')).toHaveText(collapsedText);
  await expect(page.locator('#profile-summary')).toContainText('psychological tension can work when it serves a compelling mystery.');
  await expect.poll(()=>page.locator('#profile-summary').evaluate(x=>x.getAnimations().some(animation=>animation.playState==='running'))).toBe(false);
  const expanded=await page.locator('#profile-summary').evaluate(x=>({height:x.clientHeight,contentHeight:x.scrollHeight}));
  expect(expanded.contentHeight).toBeLessThanOrEqual(expanded.height+1);
  await page.screenshot({path:info.outputPath(`profile-polish-${theme}-expanded.png`)});
  await page.locator('[data-expand="profile-summary"]').click();await expect(page.locator('#profile-summary')).toHaveClass(/is-collapsed/);
  await page.getByRole('tab',{name:'History',exact:true}).click();
  await expect(page.locator('.profile-history-item')).toHaveCount(2);
  await expect(page.locator('.profile-history-dates')).toHaveText(['Started 1 Mar 2026 · Finished 3 Mar 2026','Started 1 Jan 2026 · Finished 5 Jan 2026']);
  await expect(page.locator('.profile-history-details')).toHaveText(['2 days · 4.0/5 · Science Fiction','4 days · 3.8/5 · Science Fiction']);
  const metadata=await page.locator('.profile-history-copy small').evaluateAll(nodes=>nodes.map(x=>({whiteSpace:getComputedStyle(x).whiteSpace,overflow:getComputedStyle(x).overflow,clipped:x.scrollWidth>x.clientWidth+1})));
  expect(metadata.every(x=>x.whiteSpace==='normal'&&x.overflow==='visible'&&!x.clipped)).toBe(true);
  await page.setViewportSize({width:320,height:844});await page.screenshot({path:info.outputPath(`profile-polish-${theme}-history.png`)});
  await page.getByRole('tab',{name:'Feed',exact:true}).click();
  await page.locator('[data-identity-edit]').click();await page.locator('.profile-inline-form input[name="handle"]').fill('@'+'long_username'.repeat(6));await page.locator('.profile-inline-form button[type="submit"]').click();await expect(page.locator('.profile-inline-form')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth)).toBe(false);
  const cardSpacing=await page.locator('.activity-card').first().evaluate(card=>({header:parseFloat(getComputedStyle(card.querySelector('.activity-meta')).paddingTop),body:parseFloat(getComputedStyle(card.querySelector('.activity-body')).paddingTop),tagHeight:card.querySelector('.activity-tags button').getBoundingClientRect().height,bookHeight:card.querySelector('.activity-book').getBoundingClientRect().height}));
  expect(cardSpacing.header).toBe(10);expect(cardSpacing.body).toBe(12);expect(cardSpacing.tagHeight).toBeGreaterThanOrEqual(32);expect(cardSpacing.bookHeight).toBeGreaterThanOrEqual(44);
  expect(mock.errors).toEqual([]);
});

test('profile polish retains custom appearance colours and radii',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('reading-room-ui-preferences-v1',JSON.stringify({selectedTheme:'reading-room',appearanceOverrides:{'reading-room':{activeBg:'#343739',activeText:'#f2e8d6',cardRadius:20}}})));
  await isolatedProfile(page);
  const style=await page.locator('.profile-card').evaluate(x=>({background:getComputedStyle(x).backgroundColor,color:getComputedStyle(x).color,radius:getComputedStyle(x).borderTopLeftRadius}));
  expect(style).toEqual({background:'rgb(52, 55, 57)',color:'rgb(242, 232, 214)',radius:'20px'});
});

test('Sessions filter, duration, exact timestamp and book links work; filter row centres when it fits',async({page},info)=>{
  const mock=await isolatedProfile(page);
  mock.events.unshift({id:'70000000-0000-0000-0000-000000000001',event_type:'sessions',book_id:mock.events[0].book_id,occurred_at:new Date(Date.now()-30*60000).toISOString(),metadata:{duration_seconds:4320.75,pages_read:41},hashtags:['sessions']});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('reading-room:refresh')));
  await expect(page.locator('.activity-card').first()).toContainText('@calum finished a 1h 12m reading session of Thunderhead.');
  await page.locator('.activity-tags [data-feed-filter="sessions"]').click();
  await expect(page.locator('.activity-card')).toHaveCount(1);await expect(page.locator('.feed-filters [data-feed-filter="sessions"]')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.activity-book')).toContainText('41 pages read');await expect(page.locator('.activity-book')).toContainText('Frederik Pohl');
  const stamp=page.locator('.activity-time');const exact=await stamp.getAttribute('data-exact-time');await expect(stamp).toHaveText('30m');await stamp.click();await expect(stamp).toHaveText(exact);
  for(const width of [320,375,390,430,800]){
    await page.setViewportSize({width,height:844});
    const row=await page.locator('.feed-filters').evaluate(nav=>{
      const n=nav.getBoundingClientRect(),buttons=[...nav.querySelectorAll('button')].map(x=>x.getBoundingClientRect());
      return {fits:nav.scrollWidth<=nav.clientWidth+1,centerGap:(buttons[0].left+buttons.at(-1).right)/2-(n.left+n.right)/2,gaps:buttons.slice(1).map((r,i)=>r.left-buttons[i].right),overflow:getComputedStyle(nav).overflowX,pageOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
    });
    if(row.fits) expect(Math.abs(row.centerGap)).toBeLessThanOrEqual(1);
    expect(Math.max(...row.gaps)-Math.min(...row.gaps)).toBeLessThanOrEqual(1);expect(row.overflow).toBe('auto');expect(row.pageOverflow).toBe(false);
  }
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:info.outputPath('profile-sessions-iphone.png'),fullPage:true});
  await page.locator('.activity-book').click();await expect(page.locator('.detail-header')).toBeVisible();await page.locator('[data-back]').click();await expect(page.locator('.activity-card')).toHaveCount(1);
  mock.events.unshift({id:'70000000-0000-0000-0000-000000000002',event_type:'quotes',book_id:mock.events[0].book_id,occurred_at:new Date().toISOString(),metadata:{chapter:'Chapter 6',quote_text:'Exactly preserved.'},hashtags:['quotes']});
  await page.locator('.feed-filters [data-feed-filter="quotes"]').click();await expect(page.locator('.activity-book small')).toHaveText('Chapter 6');
  expect(mock.errors).toEqual([]);
});

for(const theme of ['reading-room','terminal']) test(`library name edit persists and record-column tabs stay plain in ${theme}`,async({page},info)=>{
  const mock=await isolatedProfile(page,{theme});
  await expect(page.locator('[data-library-name-edit]')).toHaveText('Alder Creek Library');
  await page.locator('[data-library-name-edit]').click();await expect(page.getByLabel('Library name',{exact:true})).toBeFocused();
  await page.getByLabel('Library name',{exact:true}).fill('Cancelled library');await page.getByLabel('Library name',{exact:true}).press('Escape');
  await expect(page.locator('[data-library-name-edit]')).toHaveText('Alder Creek Library');await expect(page.locator('[data-library-name-edit]')).toBeFocused();
  await page.locator('[data-library-name-edit]').click();await page.getByLabel('Library name',{exact:true}).fill('Alder Creek Reading Library');
  await page.locator('.profile-inline-form button[type="submit"]').click();await expect(page.locator('.profile-inline-form')).toHaveCount(0);
  expect(mock.profile().library_name).toBe('Alder Creek Reading Library');expect(mock.profile().handle).toBe('@calum');expect(mock.profile().short_bio).toBe('An obsolete biography.');
  await page.locator('[data-route="home"]').last().click();await page.locator('[data-route="profile"]').last().click();await expect(page.locator('[data-library-name-edit]')).toHaveText('Alder Creek Reading Library');
  await page.reload();await expect(page.locator('[data-library-name-edit]')).toHaveText('Alder Creek Reading Library');
  // A new document also exercises the persisted profile retrieval, rather than in-memory paint.
  for(const width of [320,375,390,430]){
    await page.setViewportSize({width,height:844});
    const layout=await page.locator('.profile-page').evaluate(page=>{
      const rect=s=>page.querySelector(s).getBoundingClientRect(),avatar=rect('.profile-avatar'),badge=rect('.profile-private'),heading=rect('.profile-inline-identity'),library=rect('.profile-library-name'),genres=rect('.profile-genres');
      const nav=page.querySelector('.profile-tabs'),style=getComputedStyle(nav),libraryStyle=getComputedStyle(page.querySelector('.profile-library-name'));
      const tabs=[...nav.children].map((tab,i)=>{const s=getComputedStyle(tab),r=tab.getBoundingClientRect(),divider=getComputedStyle(tab,'::before');return {height:r.height,width:r.width,background:s.backgroundColor,image:s.backgroundImage,radius:s.borderRadius,shadow:s.boxShadow,border:s.borderBottomWidth,borderColor:s.borderBottomColor,color:s.color,weight:s.fontWeight,clipped:tab.scrollWidth>tab.clientWidth+1,divider:i?divider.borderInlineStartWidth:null};});
      return {overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,photoWidth:avatar.width,topGap:badge.top-avatar.top,bottomGap:genres.bottom-avatar.bottom,order:badge.bottom<=heading.top&&heading.bottom<=library.top&&library.bottom<=genres.top,libraryTransform:libraryStyle.textTransform,libraryFont:libraryStyle.fontFamily,navBackground:style.backgroundColor,navRadius:style.borderRadius,tabs};
    });
    expect(layout.overflow).toBe(false);expect(layout.photoWidth).toBeGreaterThanOrEqual(100);expect(Math.abs(layout.topGap)).toBeLessThanOrEqual(1);expect(Math.abs(layout.bottomGap)).toBeLessThanOrEqual(1);expect(layout.order).toBe(true);
    expect(layout.libraryTransform).toBe('uppercase');expect(layout.libraryFont).toContain('sans-serif');expect(layout.navBackground).toBe('rgba(0, 0, 0, 0)');expect(layout.navRadius).toBe('0px');
    expect(Math.max(...layout.tabs.map(x=>x.width))-Math.min(...layout.tabs.map(x=>x.width))).toBeLessThan(1);
    for(const [i,tab] of layout.tabs.entries()){
      expect(tab.height).toBeGreaterThanOrEqual(44);expect(tab.clipped).toBe(false);expect(tab.background).toBe('rgba(0, 0, 0, 0)');expect(tab.image).toBe('none');expect(tab.radius).toBe('0px');expect(tab.shadow).toBe('none');if(i) expect(tab.divider).toBe('1px');
    }
    expect(layout.tabs[0].weight).toBe('600');expect(layout.tabs[0].border).toBe('1px');expect(layout.tabs[0].borderColor).toBe(layout.tabs[0].color);
    await page.screenshot({path:info.outputPath(`library-record-${theme}-${width}.png`)});
  }
  for(const tab of ['Stats','Taste Details','History','Feed']){
    await page.getByRole('tab',{name:tab,exact:true}).click();await expect(page.getByRole('tab',{name:tab,exact:true})).toHaveAttribute('aria-selected','true');
    const active=await page.getByRole('tab',{name:tab,exact:true}).evaluate(x=>({bg:getComputedStyle(x).backgroundColor,border:getComputedStyle(x).borderBottomColor,color:getComputedStyle(x).color}));expect(active.bg).toBe('rgba(0, 0, 0, 0)');expect(active.border).toBe(active.color);
  }
  await page.getByRole('tab',{name:'Feed',exact:true}).press('ArrowRight');await expect(page.getByRole('tab',{name:'Stats',exact:true})).toBeFocused();await page.getByRole('tab',{name:'Stats',exact:true}).press('End');await expect(page.getByRole('tab',{name:'History',exact:true})).toBeFocused();await page.getByRole('tab',{name:'History',exact:true}).press('Home');await expect(page.getByRole('tab',{name:'Feed',exact:true})).toBeFocused();
  expect(mock.errors).toEqual([]);
});
