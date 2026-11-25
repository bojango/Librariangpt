import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { enrichmentDb } from '../helpers/enrichment-db.js';
import { owner } from '../helpers/planner-db.js';

test('selected book additions store work and edition years independently', async t => {
  const db = await enrichmentDb({ hardened: false });
  t.after(() => db.close());
  for (const file of ['20260908080146_ai_recommendation_shelf.sql', '20261125192148_preserve_work_publication_year.sql']) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.exec(`
    create or replace function auth.uid() returns uuid language sql stable as $$select '${owner}'::uuid$$;
    insert into auth.users values ('${owner}');
    update private.app_state set owner_user_id='${owner}';
  `);
  const add = async result => (await db.query("select public.library_add_selected_result($1,'Wishlist','Not Owned') added", [
    { title: 'Fixture work', authors: ['Fixture Author'], ...result }
  ])).rows[0].added;
  const dates = async result => (await db.query(`
    select b.original_publication_year original, e.publication_year edition
    from public.books b join public.editions e on e.book_id=b.id where b.id=$1 and e.id=$2
  `, [result.book_id, result.edition_id])).rows[0];
  const first = await add({ isbn13: '9781234567897', publication_year: 2021, original_publication_year: 2004 });
  assert.deepEqual(await dates(first), { original: 2004, edition: 2021 });
  const unknown = await add({ title: 'Other work', isbn13: '9781234567880', publication_year: 2021 });
  assert.deepEqual(await dates(unknown), { original: null, edition: 2021 });
  const existing = await add({ isbn13: '9781234567897', publication_year: 2021, original_publication_year: 2010 });
  assert.equal(existing.already_in_library, true);
  assert.deepEqual(await dates(existing), { original: 2004, edition: 2021 });
});
