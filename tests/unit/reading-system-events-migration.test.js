import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../../supabase/migrations/20260914075939_add_reading_system_events_and_retry_chapter_maps.sql', import.meta.url);

test('telemetry migration is owner-readable and service-role-write-only', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /create table public\.reading_system_events/);
  assert.match(sql, /alter table public\.reading_system_events enable row level security/);
  assert.match(sql, /revoke all on table public\.reading_system_events from public, anon, authenticated/);
  assert.match(sql, /grant select on table public\.reading_system_events to authenticated/);
  assert.match(sql, /grant select, insert on table public\.reading_system_events to service_role/);
  assert.match(sql, /using \(public\.is_library_owner\(\)\)/);
  assert.doesNotMatch(sql, /grant insert[^;]+authenticated/);
});

test('retry reset touches only current-reading not-found editions with zero chapter rows', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /set chapter_map_last_checked_at = null/);
  assert.match(sql, /e\.chapter_map_status = 'not_found'/);
  assert.match(sql, /not exists \([\s\S]*public\.edition_chapters/);
  assert.match(sql, /le\.overall_status = 'Currently Reading'/);
  assert.doesNotMatch(sql, /set chapter_map_status/);
  assert.doesNotMatch(sql, /truncate|delete from public\.edition_chapters/i);
});
