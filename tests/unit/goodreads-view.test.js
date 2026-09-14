import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('book detail is wired to Goodreads-only selection and a neutral unavailable card', async () => {
  const source = await readFile(new URL('../../src/views/book-detail.js', import.meta.url), 'utf8');
  assert.match(source, /selectGoodreadsRating\(detail\.ratings\)/);
  assert.match(source, /<strong>Goodreads<\/strong><span>Rating unavailable/);
  assert.doesNotMatch(source, /otherRatings|other-ratings/);
});

test('migration makes v_library Goodreads-only and keeps stale-first batches bounded', async () => {
  const sql = await readFile(new URL('../../supabase/migrations/20260912202941_add_goodreads_rating_refresh.sql', import.meta.url), 'utf8');
  const view = sql.slice(sql.indexOf('create or replace view public.v_library'));
  assert.match(view, /lower\(x\.provider\)='goodreads'/);
  assert.doesNotMatch(view, /when 'google books'|when 'open library'/i);
  assert.match(sql, /case when c\.mapping_known then 0 else 1 end/);
  assert.match(sql, /limit least\(greatest\(coalesce\(p_limit, 6\), 1\), 8\)/);
  assert.match(sql, /distinct on \(b\.id\)/);
});
