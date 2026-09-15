import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('book detail is wired to Goodreads-only selection and a neutral unavailable card', async () => {
  const source = await readFile(new URL('../../src/views/book-detail.js', import.meta.url), 'utf8');
  assert.match(source, /selectGoodreadsRating\(detail\.ratings\)/);
  assert.match(source, /<strong>Goodreads<\/strong><span>Rating unavailable/);
  assert.doesNotMatch(source, /otherRatings|other-ratings/);
});

test('forward migration makes v_library Goodreads-only and queues every canonical book', async () => {
  const sql = await readFile(new URL('../../supabase/migrations/20260914193119_complete_goodreads_weekly_refresh.sql', import.meta.url), 'utf8');
  const view = sql.slice(sql.indexOf('create or replace view public.v_library'));
  assert.match(view, /lower\(x\.provider\)='goodreads'/);
  assert.doesNotMatch(view, /when 'google books'|when 'open library'/i);
  assert.match(sql, /case when c\.mapping_known then 0 else 1 end/);
  assert.match(sql, /limit least\(greatest\(coalesce\(p_limit, 6\), 1\), 8\)/);
  const selector = sql.slice(sql.indexOf('create or replace function public.select_due_goodreads_rating_books'), sql.indexOf('create or replace function public.claim_goodreads_rating_refresh'));
  assert.match(selector, /from public\.books b/);
  assert.doesNotMatch(selector, /join public\.library_entries/);
  assert.match(sql, /create table if not exists public\.rating_refresh_state/);
  assert.match(sql, /primary key \(book_id, provider\)/);
  assert.match(sql, /'17 0,12 \* \* \*'/);
  assert.match(sql, /'\{\"batch_size\":6\}'::jsonb/);
  assert.match(sql, /vault\.decrypted_secrets/);
});

test('hardening migration records safe diagnostics and schedules eight twice daily', async () => {
  const sql = await readFile(new URL('../../supabase/migrations/20260915083019_harden_goodreads_resolution_and_capacity.sql', import.meta.url), 'utf8');
  assert.match(sql, /last_resolution_tier/);
  assert.match(sql, /last_resolution_diagnostic jsonb/);
  assert.match(sql, /coalesce\(p_limit, 8\)/);
  assert.match(sql, /'17 0,12 \* \* \*'/);
  assert.match(sql, /'\{"batch_size":8\}'::jsonb/);
  assert.match(sql, /cron\.unschedule/);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.doesNotMatch(sql, /(?:eyJ|sb_secret_)/);
});

test('refresh function uses direct mappings, discovery fallback, upsert, and all-books metadata', async () => {
  const source = await readFile(new URL('../../supabase/functions/goodreads-rating-refresh/index.ts', import.meta.url), 'utf8');
  assert.match(source, /identity\s*\?\s*await directRefresh/);
  assert.match(source, /:\s*await discover/);
  assert.match(source, /upsert\(payload, \{ onConflict: 'book_id,provider' \}\)/);
  assert.match(source, /from\('books'\)/);
  assert.doesNotMatch(source, /from\('v_library'\)/);
  assert.match(source, /GOODREADS_SCHEDULER_TOKEN/);
  assert.match(source, /x-goodreads-scheduler-token/);
  assert.match(source, /searchIdentity\?\.providerBookId === identity\.providerBookId/);
  assert.match(source, /extractGoodreadsCandidateUrls/);
  assert.match(source, /candidateLimitForQuery/);
  assert.match(source, /Goodreads search response was not ready/);
  assert.match(source, /enrichMissingIdentity/);
  assert.match(source, /if \(bookResult\.error\)[\s\S]*?status: 'retry_scheduled'/);
});

test('scheduler-token migration keeps credentials in Vault and preserves JWT verification', async () => {
  const sql = await readFile(new URL('../../supabase/migrations/20260914194333_secure_goodreads_scheduler_token.sql', import.meta.url), 'utf8');
  assert.match(sql, /goodreads_scheduler_service_key/);
  assert.match(sql, /goodreads_scheduler_token/);
  assert.match(sql, /x-goodreads-scheduler-token/);
  assert.doesNotMatch(sql, /service_role.*(?:eyJ|sb_secret_)/i);
  const config = await readFile(new URL('../../supabase/config.toml', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /functions\.goodreads-rating-refresh[\s\S]*verify_jwt\s*=\s*false/);
});
