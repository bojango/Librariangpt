import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../../supabase/migrations/20260923145729_add_metadata_enrichment_queue.sql', import.meta.url);

test('new books are queued once and queue access remains service-only', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /unique \(book_id\)/i);
  assert.match(sql, /after insert on public\.books[\s\S]*sync_book_enrichment_queue/i);
  assert.match(sql, /after insert on public\.library_entries[\s\S]*wake_book_enrichment_queue_for_library_entry/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.book_enrichment_jobs from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete[\s\S]*to service_role/i);
});

test('queue claims are idempotent, concurrent-safe and reclaim stale work', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /status = 'processing'/i);
  assert.match(sql, /locked_at < now\(\) - interval '15 minutes'/i);
  assert.match(sql, /attempt_count = job\.attempt_count \+ 1/i);
  assert.match(sql, /limit least\(greatest\(coalesce\(p_limit, 2\), 1\), 4\)/i);
});

test('partial historical records are backfilled and server processing is scheduled', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /metadata_status not in \('resolved','manual'\)/i);
  assert.match(sql, /nullif\(trim\(book\.synopsis\), ''\) is null/i);
  assert.match(sql, /not exists[\s\S]*public\.editions/i);
  assert.match(sql, /cron\.schedule\([\s\S]*book-metadata-enrichment-every-five-minutes/i);
  assert.match(sql, /x-enrichment-scheduler-token/i);
  assert.match(sql, /body := jsonb_build_object\('batch_size', 2\)/i);
});

test('retry scheduling follows metadata_retry_after instead of polling the browser', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /greatest\(coalesce\(new\.metadata_retry_after, now\(\)\), now\(\)\)/i);
  assert.match(sql, /after update of metadata_status, metadata_retry_after, metadata_error/i);
  assert.match(sql, /when excluded\.available_at > now\(\) then 'retry'/i);
});

test('Reading Room and scheduled inserts converge on the same orchestrator', async () => {
  const [addBook, worker, content, editions] = await Promise.all([
    readFile(new URL('../../src/features/add-book.js', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/functions/book-background-enrich/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/functions/content-enrichment/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/functions/edition-options/index.ts', import.meta.url), 'utf8')
  ]);
  assert.match(addBook, /invoke\('book-background-enrich',[\s\S]*book_id/);
  assert.match(worker, /claim_book_enrichment_jobs/);
  assert.match(worker, /for \(const job of jobs\)/);
  assert.match(worker, /\['edition-options', 'goodreads-rating-refresh', 'content-enrichment'\]/);
  assert.match(worker, /metadata_retry_after/);
  assert.match(worker, /status: complete \? 'completed' : 'retry'/);
  assert.match(content, /serviceCaller[\s\S]*apiKey === serviceKey/);
  assert.match(editions, /serviceCaller[\s\S]*apiKey === serviceKey/);
});
