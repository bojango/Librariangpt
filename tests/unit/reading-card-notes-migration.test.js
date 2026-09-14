import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = 'supabase/migrations/20260913171316_add_reading_card_notes_and_chapter_orchestration.sql';

test('reading-card note migration uses bigint progress ids and owner-only writes', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /progress_log_id bigint references public\.progress_logs\(id\)/);
  assert.match(sql, /char_length\(btrim\(note_text\)\) between 1 and 400/);
  assert.match(sql, /security definer\s+set search_path = ''/);
  assert.match(sql, /v_uid is null or not private\.is_owner\(\)/);
  assert.match(sql, /revoke all on public\.reading_card_notes from public, anon, authenticated/);
  assert.match(sql, /grant select on public\.reading_card_notes to authenticated/);
  assert.doesNotMatch(sql, /grant (?:insert|all).*reading_card_notes to authenticated/i);
});

test('save RPC validates ownership, note bounds, duplicates, and retains history', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /le\.user_id = v_uid and le\.book_id = p_book_id/);
  assert.match(sql, /Note text is required/);
  assert.match(sql, /Note text must be 400 characters or fewer/);
  assert.match(sql, /reading_card_notes_exact_duplicate_idx/);
  assert.match(sql, /on conflict do nothing/);
  assert.match(sql, /return jsonb_build_object\('saved', false/);
  assert.doesNotMatch(sql, /update public\.reading_card_notes/);
});

test('latest-note view is strict to the active reread session', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /rs\.status = 'Reading'/);
  assert.match(sql, /n\.session_id = active_session\.id/);
  assert.doesNotMatch(sql, /n\.session_id is null/);
  assert.match(sql, /security_invoker = true/);
});

test('check-in snapshot preserves bounded context and adds latest_card_note', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const field of ['state', 'current_chapter', 'recent_progress', 'recent_feedback', 'recent_events', 'taste_profile', 'up_next', 'active_recommendations', 'latest_card_note']) {
    assert.match(sql, new RegExp(`'${field}'`));
  }
  assert.match(sql, /n\.session_id = ids\.session_id/);
});

test('chapter view exposes map existence without changing page-range matching', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /as has_chapter_map/);
  assert.match(sql, /c\.start_page <= v\.current_page/);
  assert.match(sql, /c\.end_page is null or c\.end_page >= v\.current_page/);
});

test('optional note dataset is isolated from the required library query', async () => {
  const source = await readFile('src/data/library.js', 'utf8');
  assert.match(source, /optional\(supabase\.from\('v_latest_reading_card_notes'\)/);
  assert.match(source, /books: unwrap\(books\)/);
});
