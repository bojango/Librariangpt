import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
globalThis.document = { querySelector: () => ({ innerHTML: '', querySelectorAll: () => [], querySelector: () => null }) };
globalThis.window = { setTimeout, clearTimeout };
globalThis.HTMLElement = class {};
globalThis.customElements = { get: () => undefined, define: () => {} };
const { bookDetailView } = await import('../../src/views/book-detail.js');

function state(book = {}) {
  return { detail: { book: { id: 'book-1', title: 'Into the Wild', authors: 'Jon Krakauer', overall_status: 'Currently Reading', ownership_status: 'Owned', current_page: 44, total_pages: 100, fiction_nonfiction: 'Nonfiction', ...book }, ratings: [], recommendation: null, quotes: [{ id: 'q1', quote_text: 'First paragraph\n\nSecond paragraph', page_start: 4, note: 'Keep this' }], editions: [], latestReadingNote: { note_text: 'A small note' } }, chapters: [], route: { name: 'book' } };
}

test('book detail maps fiction label, preserves quote newlines, and groups reading controls under Progress', () => {
  const html = bookDetailView(state());
  assert.match(html, />Nonfiction</);
  assert.match(html, /<h2>Progress<\/h2>[\s\S]*data-progress=/);
  assert.match(html, /First paragraph\n\nSecond paragraph/);
  assert.match(html, /class="detail-actions progress-actions"/);
  assert.equal((html.match(/class="btn/g) || []).filter(x => x).length >= 5, true);
  assert.match(html, /class="visible-metadata"[\s\S]*Pages/);
  assert.ok(html.indexOf('class="metadata-accordion"') > html.indexOf('class="visible-metadata"'));
});

test('detail source keeps BOOK as fallback and loads fiction_nonfiction through v_library', async () => {
  const [detail, library, css, metadata] = await Promise.all([readFile('src/views/book-detail.js', 'utf8'), readFile('src/data/library.js', 'utf8'), readFile('src/styles/app.css', 'utf8'), readFile('supabase/functions/book-metadata/index.ts', 'utf8')]);
  assert.match(detail, /book\.fiction_nonfiction/);
  assert.match(library, /v_library.*\.select\('\*'\)/s);
  assert.match(css, /\.saved-quote-v40 blockquote\{[^}]*white-space:pre-line/);
  assert.match(css, /\.progress-actions\{[^}]*flex-wrap:nowrap/);
  assert.match(metadata, /fictionNonfiction\(body\?\.fiction_nonfiction\)/);
  assert.match(metadata, /update\(\{ fiction_nonfiction: requestedFictionNonfiction \}\)/);
});
