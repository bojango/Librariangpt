import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chapterRows, selectSafeAlternate, usableToc } from '../../supabase/functions/chapter-map/core.js';

const requested = {
  title: 'There Is No Antimemetics Division', language: 'English', publisher: 'Del Rey', imprint: null,
  publication_year: 2025, page_count: 275, open_library_edition_id: 'OL1M',
};
const exact = {
  key: '/books/OL1M', title: requested.title, publishers: ['Del Rey'], languages: [{ key: '/languages/eng' }],
  number_of_pages: 275, works: [{ key: '/works/OL1W' }],
};
const toc = [
  { title: 'Chapter 1 - Arrival', pagenum: '5', level: 1 },
  { title: 'Chapter 2 - Memory', pagenum: '40', level: 1 },
];
const candidate = overrides => ({
  key: '/books/OL2M', title: requested.title, publishers: ['Del Rey Ltd'], publish_date: '2025',
  languages: [{ key: '/languages/eng' }], number_of_pages: 275,
  works: [{ key: '/works/OL1W' }], table_of_contents: toc, ...overrides,
});
const choose = entries => selectSafeAlternate({ requested, exactEdition: exact, candidates: entries, expectedWorkId: 'OL1W' });

test('exact-edition TOC parsing and rows retain their original page numbers', () => {
  const parsed = usableToc({ ...exact, table_of_contents: toc });
  assert.equal(parsed.usable, true);
  assert.deepEqual(parsed.rows.map(row => row.start_page), [5, 40]);
  const rows = chapterRows(parsed.rows, { editionId: 'edition-uuid', sourceEditionId: 'OL1M' });
  assert.deepEqual(rows.map(row => row.start_page), [5, 40]);
  assert.match(rows[0].source_url, /OL1M$/);
});

test('exact edition without TOC permits conservative same-work discovery', () => {
  assert.equal(usableToc(exact).usable, false);
  const selected = choose([candidate()]);
  assert.equal(selected.candidate.key, '/books/OL2M');
  assert.equal(selected.matchingReason, 'same_work_same_page_count_same_publisher');
  assert.deepEqual(selected.rows.map(row => row.start_page), [5, 40]);
});

test('alternate candidates require exact page count, a known page count, and the same work', () => {
  assert.equal(choose([candidate({ number_of_pages: 274 })]).candidate, null);
  assert.equal(choose([candidate({ number_of_pages: undefined, pagination: undefined })]).candidate, null);
  assert.equal(choose([candidate({ works: [{ key: '/works/OL999W' }] })]).candidate, null);
});

test('title alone is insufficient and compatible language plus publisher family are required', () => {
  assert.equal(choose([candidate({ languages: [{ key: '/languages/spa' }] })]).candidate, null);
  assert.equal(choose([candidate({ publishers: ['Unrelated Press'] })]).candidate, null);
  assert.equal(choose([candidate({ title: 'A Different Title' })]).candidate, null);
});

test('nonsensical or non-monotonic page numbers reject the entire candidate', () => {
  const bad = candidate({ table_of_contents: [
    { title: 'First', pagenum: '40' }, { title: 'Second', pagenum: '12' },
  ] });
  assert.equal(usableToc(bad).reason, 'nonsensical_pages');
  assert.equal(choose([bad]).candidate, null);
  assert.equal(usableToc(candidate({ table_of_contents: [{ title: 'Impossible', pagenum: '-1' }] })).usable, false);
});

test('no proportional mapping occurs and no safe match yields no rows', () => {
  const oldEdition = candidate({ number_of_pages: 220, table_of_contents: [{ title: 'Old chapter', pagenum: '100' }] });
  const selected = choose([oldEdition]);
  assert.equal(selected.candidate, null);
  assert.deepEqual(selected.rows, []);
  assert.equal(JSON.stringify(selected).includes('125'), false);
});

test('chapter fallback telemetry code never adds chapter or TOC text to metadata', async () => {
  const source = await readFile(new URL('../../supabase/functions/chapter-map/index.ts', import.meta.url), 'utf8');
  const metadataObjects = [...source.matchAll(/await log\([\s\S]*?\);/g)].map(match => match[0]).join('\n');
  assert.ok(metadataObjects.length > 0);
  assert.doesNotMatch(metadataObjects, /chapter_title|table_of_contents|\.title/);
});
