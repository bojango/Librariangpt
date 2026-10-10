import test from 'node:test';
import assert from 'node:assert/strict';
import { activityCard, activityTime, feedTab } from '../../src/features/activity-feed.js';
import { tasteIdentity } from '../../src/features/taste-identity.js';
import { profileView } from '../../src/views/profile.js';
import { loadActivity } from '../../src/data/activity.js';

const book = { id: 'book', title: '<Gateway>', authors: 'Fred Pohl', primary_genre: 'Science Fiction', overall_status: 'Read', cover_url: '/cover.jpg' };
const state = { books: [book], profile: { display_name: 'Calum', handle: '@calum' }, tasteProfile: [], readingHistory: [] };
test('timestamp boundaries use elapsed hours and full local dates, including DST', () => {
  const now = new Date('2026-10-26T12:00:00Z');
  for (const [hours,label] of [[0,'now'],[0.5,'30m'],[2,'2h'],[23.99,'23h'],[24,'1d'],[47.99,'1d']]) {
    const result = activityTime(new Date(+now-hours*3600000).toISOString(),now);
    assert.equal(result.label,label); assert.equal(result.relative,true); assert.notEqual(result.exact,label);
  }
  const result = activityTime(new Date(+now-48*3600000).toISOString(),now);
  assert.equal(result.relative,false); assert.equal(result.label,result.exact);
  assert.equal(activityTime('invalid').label,'Date unavailable');
});
test('feed escapes text, preserves exact multiline quotes and exposes book and hashtag links', () => {
  const quote = '  Line one\n\n<script>alert(1)</script>\nLine three  ';
  const html = activityCard({ id:'quote',event_type:'quotes',book_id:'book',occurred_at:'2026-10-10',metadata:{quote_text:quote,page_start:12,page_end:14,chapter:'One',note:'<note>'},hashtags:['quotes'] },state);
  assert.match(html,/  Line one\n\n&lt;script&gt;/); assert.doesNotMatch(html,/<script>/);
  assert.match(html,/data-open-book="book"/); assert.match(html,/p\. 12–14 · Chapter One/);
  assert.match(html,/data-feed-filter="quotes"/); assert.match(html,/&lt;note&gt;/);
  assert.match(activityCard({id:'l',event_type:'librarian',content:'Reflection',occurred_at:'2026-10-10'},state),/>Librarian<\/strong>/);
});
test('feed covers loading, empty, error and progressively loaded states', () => {
  for (const [feed,pattern] of [[{loading:true,events:[],filter:'all'},/Loading your reading timeline/],[{loading:false,events:[],filter:'all'},/No activity here yet/],[{error:'offline',events:[],filter:'all'},/data-feed-retry/],[{hasMore:true,events:[{id:'x',event_type:'started'}],filter:'all'},/data-feed-more/]]) assert.match(feedTab({...state,activityFeed:feed}),pattern);
});
test('taste genres require reliable positive supporting book evidence, with no guessed or fixed genres', () => {
  const signal = {id:'taste',dimension:'Worldbuilding',preference:'Enjoys gradual discovery.',direction:'Positive',strength:'Strong',confidence:'High',evidence_count:3,taste_evidence:[{book_id:'book',relation:'supports',weight:1}]};
  assert.deepEqual(tasteIdentity([signal],[book]).genres,['Science Fiction']);
  for (const patch of [{confidence:'Low'},{evidence_count:1},{direction:'Mixed'},{direction:'Negative'},{taste_evidence:[{book_id:'book',relation:'context'}]}]) assert.deepEqual(tasteIdentity([{...signal,...patch}],[book]).genres,[]);
  assert.deepEqual(tasteIdentity([signal],[{...book,primary_genre:'Mystery'}]).genres,['Mystery']);
  assert.equal(tasteIdentity([signal],[book]).summary,'Enjoys gradual discovery.');
});
test('profile defaults to Feed, keeps summary sourced and history retains session-specific dates and rereads', () => {
  assert.match(profileView(state),/id="profile-tab-feed"[^>]*aria-selected="true"/);
  assert.match(profileView({...state,profile:{...state.profile,short_bio:'Old generic bio'}}),/reading identity will take shape/);
  assert.doesNotMatch(profileView(state),/data-profile-edit|data-nfc-bookmarks|profile-avatar-action-icon/);
  const html = profileView({...state,profileTab:'history',readingHistory:[{id:'one',book_id:'book',started_at:'2026-01-01',completed_at:'2026-01-05',user_rating_5:3.8},{id:'two',book_id:'book',started_at:'2026-02-01',completed_at:'2026-02-03',user_rating_5:null}]});
  assert.equal((html.match(/class="profile-history-item"/g)||[]).length,2);
  assert.match(html,/Read in 4 days/); assert.match(html,/Read in 2 days/); assert.match(html,/Unrated/); assert.match(html,/Science Fiction/);
  assert.match(html,/id="profile-panel-history"[^>]*><section class="history-year"><h3>2026/);
});
test('activity repository uses stable keyset pagination and owner RLS without hiding query errors', async () => {
  const calls=[]; const rows=Array.from({length:21},(_,i)=>({id:String(i)}));
  const query=new Proxy({}, {get:(_,key)=>key==='then' ? resolve=>resolve({data:rows,error:null}) : (...args)=>{calls.push([key,...args]);return query;}});
  const page=await loadActivity({filter:'quotes',cursor:{id:'10000000-0000-0000-0000-000000000001',occurred_at:'2026-10-10T10:00:00Z'}},{from:()=>query});
  assert.equal(page.events.length,20); assert.equal(page.hasMore,true);
  assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='event_type'&&c[2]==='quotes'));
  assert.ok(calls.some(c=>c[0]==='or'&&c[1].includes('id.lt.')));
  await assert.rejects(loadActivity({cursor:{id:'invalid',occurred_at:'x'}},{from:()=>query}),/Invalid activity cursor/);
});
