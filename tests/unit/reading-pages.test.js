import test from 'node:test';
import assert from 'node:assert/strict';
import { lifetimePagesRead } from '../../src/utils/reading-pages.js';
import { loadReadingRecords } from '../../src/data/library.js';

test('lifetime pages count each completed read/reread and partial lifecycle once, never its library mirror', () => {
  const records = [
    {id:'first',book_id:'b',status:'Completed',total_pages:300,current_page:300},
    {id:'reread',book_id:'b',status:'Completed',total_pages:280,current_page:280},
    {id:'again',book_id:'b',status:'Reading',total_pages:280,current_page:42},
    {id:'paused',book_id:'p',status:'Paused',current_page:22},
    {id:'dnf',book_id:'d',status:'DNF',total_pages:100,current_page:15}
  ];
  const books = [{id:'b',overall_status:'Currently Reading',current_page:42,total_pages:280}];
  assert.equal(lifetimePagesRead([...records,records[0]],books),659);
  // Overlapping timed ranges and test timers have no role in lifetime page counts.
  assert.equal(lifetimePagesRead([...records,{id:'timer',book_id:'b',session_kind:'test',start_page:42,end_page:60}],books),659);
});

test('legacy library pages, missing totals and invalid progress are handled conservatively', () => {
  assert.equal(lifetimePagesRead([], [
    {id:'completed',overall_status:'Read',total_pages:250},
    {id:'current',overall_status:'Currently Reading',current_page:30,total_pages:200},
    {id:'wishlist',overall_status:'Wishlist',total_pages:500},
    {id:'owned',overall_status:'Owned - Unread',current_page:200},
    {id:'unknown',overall_status:'Read'},
    {id:'paused',overall_status:'Paused',current_page:-5}
  ]),280);
  assert.equal(lifetimePagesRead([
    {id:'a',book_id:'a',status:'Completed',current_page:80},
    {id:'b',book_id:'b',status:'Reading',current_page:220,total_pages:200},
    {id:'c',book_id:'c',status:'Reading',current_page:Infinity},
    {id:'d',book_id:'d',status:'Planned',current_page:90}
  ]),280);
});

test('canonical pages loader paginates beyond Supabase limits and propagates errors', async () => {
  const calls=[];
  const rows=Array.from({length:1003},(_,i)=>({id:String(i)}));
  const client={from(table){assert.equal(table,'reading_sessions');return {select(){return this;},order(){return this;},range(start,end){calls.push([start,end]);return Promise.resolve({data:rows.slice(start,end+1)});}};}};
  assert.equal((await loadReadingRecords(client)).length,1003);
  assert.deepEqual(calls,[[0,999],[1000,1999]]);
  await assert.rejects(loadReadingRecords({from(){return {select(){return this;},order(){return this;},range(){return Promise.resolve({error:new Error('Offline')});}};}}),/Offline/);
});
