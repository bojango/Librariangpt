import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeSeriesBooks,
  excludeSeriesFromAuthor,
  readRelatedCache,
  RELATED_BOOKS_CACHE_MAX_AGE_MS,
  relatedDataFingerprint,
  relatedStatus,
  mergeRelatedData,
  mergeRelatedItems,
  normaliseRelatedItem,
  writeRelatedCache
} from '../../src/utils/related-books.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

test('related status distinguishes read, wishlist, owned and external items', () => {
  assert.equal(relatedStatus({ overall_status: 'Read' }).label, 'Read');
  assert.equal(relatedStatus({ overall_status: 'Wishlist' }).label, 'Wishlist');
  assert.equal(relatedStatus({ ownership_status: 'Owned' }).label, 'Owned');
  assert.equal(relatedStatus({ kind: 'external' }).label, 'Not in your library');
});

test('series editions deduplicate by canonical/work IDs, retaining the library cover and original order',()=>{
 const external={kind:'external',title:'Second work',authors:'Test Author',provider_id:'/books/OL2M',add_payload:{open_library_work_id:'OL2W'},cover_url:'discovery.jpg'};
 const library={kind:'library',book_id:'canonical',title:'Second work',authors:'Test Author',open_library_work_id:'/works/OL2W',cover_url:'selected-edition.jpg',overall_status:'Read'};
 const other={kind:'external',title:'Third work',authors:'Test Author',discovery_id:'OL3W'};
 const items=[external,other,{...external,provider_id:'/books/OL4M'},library,{...library,id:'another-edition'}];
 const result=dedupeSeriesBooks(items);
 assert.deepEqual(result,[library,other]);assert.equal(result[0],library);assert.equal(items.length,5);
});

test('series deduplication preserves distinct works with the same title',()=>{
 for(const pair of [
  [{book_id:'one'},{book_id:'two'}],
  [{open_library_work_id:'OL1W'},{open_library_work_id:'OL2W'}],
  [{series_order:1},{series_order:2}],
  [{publication_year:1990},{publication_year:2010}],
  [{authors:'One Author'},{authors:'Other Author'}],
  [{authors:null},{authors:null}]
 ]) assert.equal(dedupeSeriesBooks(pair.map(item=>({kind:'external',title:'Shared title',authors:'Test Author',...item}))).length,2);
});

test('anonymous edition duplicates require matching title and authors and preserve the first cover',()=>{
 const first={kind:'external',title:'Dune',authors:['Frank Herbert'],cover_url:'first.jpg'};
 assert.deepEqual(dedupeSeriesBooks([first,{...first,authors:'Frank Herbert',provider_id:'different-edition',cover_url:'second.jpg'}]),[first]);
});

test('cache refresh cannot replace a canonical cover with a duplicate edition from the same response',()=>{
 const selected={kind:'library',book_id:'canonical',title:'Second book',cover_url:'selected.jpg'};
 const data={series:{name:'Series',books:[selected,{...selected,cover_url:'duplicate.jpg'}]},author:{name:'Author',books:[{title:'Other work',cover_url:'author.jpg'}]}};
 const first=mergeRelatedData(null,data),second=mergeRelatedData(first,data);
 assert.equal(first.series.books.length,1);assert.equal(second.series.books.length,1);
 assert.equal(second.series.books[0].cover_url,'selected.jpg');assert.deepEqual(second.author,data.author);
});

test('current-book edition aliases require source work identity, matching author/year and no conflicting official position',()=>{
 const current={book_id:'bob',title:'We Are Legion (We Are Bob)',authors:'Dennis E. Taylor',series_order:1,publication_year:2016};
 const alias={kind:'external',title:'We Are Legion',authors:'Dennis E. Taylor',discovery_id:'OL19123425W',series_order:null,publication_year:2016};
 const omnibus={...alias,title:'The Bobiverse'};
 assert.deepEqual(dedupeSeriesBooks([alias,{...current,book_id:'bob'},omnibus],current),[omnibus]);
 for(const changed of [{series_order:2},{publication_year:2017},{authors:'Other Author'},{publication_year:null},{book_id:'distinct-canonical'},{discovery_id:null}]) {
  const distinct={...alias,...changed};assert.deepEqual(dedupeSeriesBooks([distinct],current),[distinct]);
 }
});

test('author shelf excludes books already represented by the series shelf', () => {
  const series = [
    { book_id: 'wool', title: 'Wool' },
    { book_id: 'shift', title: 'Shift' },
    { book_id: 'dust', title: 'Dust' }
  ];
  const author = [
    { book_id: 'wool', title: 'Wool' },
    { book_id: 'beacon', title: 'Beacon 23' },
    { kind: 'external', title: 'Dust' },
    { kind: 'external', title: 'Sand' }
  ];
  assert.deepEqual(excludeSeriesFromAuthor(series, author).map(item => item.title), ['Beacon 23', 'Sand']);
});

test('related-book responses persist in local storage and remain readable across visits', () => {
  const storage = memoryStorage();
  const data = { series: { name: 'Silo', books: [{ title: 'Shift' }] }, author: null };
  assert.equal(writeRelatedCache(storage, 'wool', data, 1_000), true);
  assert.deepEqual(readRelatedCache(storage, 'wool', 5_000), data);
  assert.equal(relatedDataFingerprint(readRelatedCache(storage, 'wool', 5_000)), relatedDataFingerprint(data));
});

test('related-book cache expires after the fallback window', () => {
  const storage = memoryStorage();
  const data = { author: { name: 'Michael Crichton', books: [{ title: 'Sphere' }] } };
  writeRelatedCache(storage, 'jurassic-park', data, 1_000);
  assert.equal(readRelatedCache(storage, 'jurassic-park', 1_000 + RELATED_BOOKS_CACHE_MAX_AGE_MS + 1), null);
});

test('refresh merges incomplete covers into cached related books without downgrading them', () => {
  const cached = { series: { name: 'Silo', books: [{ kind: 'external', provider_id: 'ol-1', title: 'Shift', cover_url: 'https://covers/shift.jpg', synopsis: 'Useful' }] }, author: null };
  const refreshed = { series: { name: 'Silo', books: [{ kind: 'external', provider_id: 'ol-1', title: 'Shift', cover_url: null }] }, author: null };
  const merged = mergeRelatedData(cached, refreshed);
  assert.equal(merged.series.books[0].cover_url, 'https://covers/shift.jpg');
  assert.equal(merged.series.books[0].synopsis, 'Useful');
});

test('empty or partial provider shelves retain a valid cached shelf', () => {
  const cached = { series: { name: 'Silo', books: [{ title: 'Shift' }] }, author: { name: 'Hugh Howey', books: [{ title: 'Beacon 23' }] } };
  const refreshed = { series: { name: 'Silo', books: [] }, author: null };
  const merged = mergeRelatedData(cached, refreshed);
  assert.equal(merged.series.books.length, 1);
  assert.equal(merged.author.books.length, 1);
});

test('duplicate related books merge deterministically and cover fields normalize for rendering', () => {
  const books = mergeRelatedItems([{ book_id: 'library-1', title: 'Dune', cover_url_preferred: 'https://covers/dune.jpg' }], [{ book_id: 'library-1', title: 'Dune', authors: 'Frank Herbert', cover_url: null }]);
  assert.equal(books.length, 1);
  assert.equal(books[0].cover_url, 'https://covers/dune.jpg');
  assert.equal(normaliseRelatedItem({ title: 'Dune', cover_url_preferred: 'https://covers/dune.jpg' }).cover_url, 'https://covers/dune.jpg');
});
