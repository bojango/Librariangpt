import test from 'node:test';
import assert from 'node:assert/strict';
import { excludeSeriesFromAuthor, relatedStatus } from '../../src/features/related-books.js';

test('related status distinguishes read, wishlist, owned and external items', () => {
  assert.equal(relatedStatus({ overall_status: 'Read' }).label, 'Read');
  assert.equal(relatedStatus({ overall_status: 'Wishlist' }).label, 'Wishlist');
  assert.equal(relatedStatus({ ownership_status: 'Owned' }).label, 'Owned');
  assert.equal(relatedStatus({ kind: 'external' }).label, 'Not in your library');
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
