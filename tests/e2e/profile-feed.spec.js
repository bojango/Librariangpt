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
  let profile = {display_name:'Calum',handle:'@calum',short_bio:'An obsolete biography.',avatar_path:null};
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
    if(path.includes('/rest/v1/reading_sessions')) return json(url.searchParams.get('status') ? [{id:'one',book_id:book.id,status:'Completed',started_at:'2026-01-01',completed_at:'2026-01-05',user_rating_5:3.8},{id:'two',book_id:book.id,status:'Completed',started_at:'2026-03-01',completed_at:'2026-03-03',user_rating_5:4}] : null);
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
  return {events,errors,quotes,get uploads(){return avatarUploads;},recover(){failFeed=false;},profile:()=>profile};
}

test('iPhone profile feed, timestamp, filters, pagination, all tabs and back navigation', async ({page},info) => {
  const mock=await isolatedProfile(page);
  await expect(page.getByRole('tab',{name:'Feed',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.activity-card')).toHaveCount(20);
  await expect(page.locator('.profile-inline-identity')).toHaveText('@calum');
  await expect(page.locator('.profile-genres')).toHaveText('Science Fiction');
  await expect(page.locator('.profile-card-stats strong')).toHaveText(['1','1','1']);
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
  await page.getByRole('tab',{name:'History',exact:true}).click();await expect(page.locator('.history-year h3')).toHaveText('2026');await expect(page.locator('.profile-history-item')).toHaveCount(2);await expect(page.locator('.profile-history-list')).toContainText('Read in 4 days');
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
