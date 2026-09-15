import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { librarianNoteMarkup } from '../../src/views/librarian-note.js';

test('current book note markup is safely escaped and untruncated', () => {
  const html = librarianNoteMarkup({ overall_status: 'Currently Reading' }, { note_text: '<b>Read this whole note without clipping.</b>' });
  assert.doesNotMatch(html, /<b>Read/);
  assert.match(html, /&lt;b&gt;Read this whole note without clipping\.&lt;\/b&gt;/);
});

test('book detail omits note markup when missing or the book is not currently reading', () => {
  assert.equal(librarianNoteMarkup({ overall_status: 'Currently Reading' }, null), '');
  assert.equal(librarianNoteMarkup({ overall_status: 'Read' }, { note_text: 'Old session note' }), '');
});

test('book-note CSS has no line clamp, ellipsis, or hidden overflow', async () => {
  const css = await readFile('src/styles/app.css', 'utf8');
  const rule = css.match(/\.book-librarian-note p\{([^}]*)\}/)?.[1] || '';
  assert.match(rule, /overflow:visible/);
  assert.doesNotMatch(rule, /line-clamp|ellipsis|overflow:hidden/);
});

test('book detail loader requests only the latest note for the selected book', async () => {
  const source = await readFile('src/data/library.js', 'utf8');
  assert.match(source, /v_latest_reading_card_notes[\s\S]*?\.eq\('book_id', bookId\)\.maybeSingle\(\)/);
  const snapshot = source.slice(source.indexOf('export function loadLibrarySnapshot'), source.indexOf('export function loadBookDetail'));
  assert.doesNotMatch(snapshot, /reading_card_notes|readingCardNotes/);
});

test('book detail places note markup after ratings and before Synopsis', async () => {
  const source = await readFile('src/views/book-detail.js', 'utf8');
  const render = source.slice(source.indexOf('const content ='));
  assert.ok(render.indexOf('rating-primary-row') < render.indexOf('librarianNoteMarkup(book, detail.latestReadingNote)'));
  assert.ok(render.indexOf('librarianNoteMarkup(book, detail.latestReadingNote)') < render.indexOf('book-synopsis'));
});
