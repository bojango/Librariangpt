import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildLibraryPayload } from '../../src/features/book-admin-payload.js';

function formData(values) {
  return { get: key => values[key] ?? '' };
}

test('unchanged Wishlist status is omitted when ownership becomes Owned', () => {
  const payload = buildLibraryPayload(formData({
    overall_status: 'Wishlist', ownership_status: 'Owned', reading_priority: '',
    started_date: '', completed_date: '', current_page: '', display_edition_id: ''
  }), { overall_status: 'Wishlist', ownership_status: 'On Order' });
  assert.equal(payload.ownership_status, 'Owned');
  assert.equal(Object.hasOwn(payload, 'overall_status'), false);
});

test('Wishlist remains explicit when ownership changes from Not Owned to On Order', () => {
  const payload = buildLibraryPayload(formData({ overall_status: 'Wishlist', ownership_status: 'On Order' }), {
    overall_status: 'Wishlist', ownership_status: 'Not Owned'
  });
  assert.equal(payload.overall_status, 'Wishlist');
  assert.equal(payload.ownership_status, 'On Order');
});

test('an intentional reading status remains explicit during an ownership change', () => {
  for (const status of ['Owned - Unread', 'Currently Reading', 'Read', 'Paused', 'DNF', 'Not Interested']) {
    const payload = buildLibraryPayload(formData({ overall_status: status, ownership_status: 'Owned' }), {
      overall_status: 'Wishlist', ownership_status: 'On Order'
    });
    assert.equal(payload.overall_status, status);
  }
});

test('Book Settings keeps recognition forms outside the main settings form', async () => {
  const source = await readFile(new URL('../../src/features/book-admin.js', import.meta.url), 'utf8');
  const mainStart = source.indexOf('<form id="book-admin-form">');
  const mainEnd = source.indexOf('</form>', mainStart);
  const recognitionSection = source.indexOf('${accoladesFields(bundle)}');
  assert.ok(mainStart >= 0 && mainEnd > mainStart);
  assert.ok(recognitionSection > mainEnd, 'recognition forms must be siblings, not descendants, of the main form');
  assert.match(source, /type="button" class="btn btn-primary" data-book-admin-save>Save changes/);
  assert.doesNotMatch(source, /form="book-admin-form"/);
  assert.match(source, /\[data-accolade-row\][\s\S]*saveAccoladeRow/);
  assert.match(source, /\[data-accolade-add\][\s\S]*addAccolade/);
});

test('admin_edit_book retains its automatic Owned - Unread transition', async () => {
  const sql = await readFile(new URL('../../supabase/migrations/20260907182827_add_book_admin_editor.sql', import.meta.url), 'utf8');
  assert.match(sql, /v_ownership='Owned'[\s\S]*not \(p_library \? 'overall_status'\)[\s\S]*v_status in \('Recommended','Wishlist'\)[\s\S]*v_status := 'Owned - Unread'/);
});
