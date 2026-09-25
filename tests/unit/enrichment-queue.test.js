import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ENRICHMENT_MAX_ATTEMPTS,
  enrichmentRetryPlan,
  hasValidSchedulerCredentials
} from '../../supabase/functions/_shared/enrichment-queue.js';

const migrationUrl = new URL('../../supabase/migrations/20260923145729_add_metadata_enrichment_queue.sql', import.meta.url);

test('inserting a plain books record without a Library entry does not produce processable enrichment work', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /unique \(book_id\)/i);
  assert.match(sql, /after insert on public\.library_entries[\s\S]*wake_book_enrichment_queue_for_library_entry/i);
  assert.doesNotMatch(sql, /create trigger books_enqueue_metadata_after_insert/i);
  assert.match(sql, /insert into public\.book_enrichment_jobs[\s\S]*new\.book_id/i);
  assert.match(sql, /if not exists \(select 1 from public\.library_entries where book_id = new\.id\)/i);
  assert.match(sql, /after delete on public\.library_entries[\s\S]*remove_book_enrichment_queue_for_library_entry/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /revoke all on table public\.book_enrichment_jobs from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete[\s\S]*to service_role/i);
});

test('adding a library_entries row makes the same book eligible for enrichment', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /after insert on public\.library_entries[\s\S]*wake_book_enrichment_queue_for_library_entry/i);
  assert.match(sql, /insert into public\.book_enrichment_jobs[\s\S]*select new\.book_id/i);
});

test('queue claims are idempotent, concurrent-safe and reclaim stale work', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /status = 'processing'/i);
  assert.match(sql, /locked_at < now\(\) - interval '15 minutes'/i);
  assert.match(sql, /attempt_count = job\.attempt_count \+ 1/i);
  assert.match(sql, /limit least\(greatest\(coalesce\(p_limit, 2\), 1\), 4\)/i);
});

test('orphaned jobs cannot be claimed', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /exists \([\s\S]*from public\.library_entries entry[\s\S]*entry\.book_id = job\.book_id/i);
  assert.match(sql, /after delete on public\.library_entries[\s\S]*remove_book_enrichment_queue_for_library_entry/i);
});

test('historical backfill is restricted to Library books and server processing is scheduled', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /metadata_status not in \('resolved','manual'\)/i);
  assert.match(sql, /nullif\(trim\(book\.synopsis\), ''\) is null/i);
  assert.match(sql, /not exists[\s\S]*public\.editions/i);
  assert.match(sql, /from public\.books book\s+join public\.library_entries entry on entry\.book_id = book\.id/i);
  assert.match(sql, /cron\.schedule\([\s\S]*book-metadata-enrichment-every-five-minutes/i);
  assert.match(sql, /x-enrichment-scheduler-token/i);
  assert.match(sql, /body := jsonb_build_object\('batch_size', 2\)/i);
});

test('metadata updates retain provider retry deadlines without reviving terminal jobs', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /greatest\(coalesce\(new\.metadata_retry_after, now\(\)\), now\(\)\)/i);
  assert.match(sql, /after update of metadata_status, metadata_retry_after, metadata_error/i);
  assert.match(sql, /when excluded\.available_at > now\(\) then 'retry'/i);
  assert.match(sql, /when public\.book_enrichment_jobs\.status = 'failed'\s+then 'failed'/i);
});

test('retry backoff increases, honours later provider deadlines, and becomes terminal', () => {
  const now = Date.parse('2026-09-25T12:00:00.000Z');
  const first = enrichmentRetryPlan(1, null, now);
  const second = enrichmentRetryPlan(2, null, now);
  const providerLimited = enrichmentRetryPlan(1, '2026-09-26T12:00:00.000Z', now);
  const terminal = enrichmentRetryPlan(ENRICHMENT_MAX_ATTEMPTS, null, now);

  assert.equal(first.terminal, false);
  assert.equal(Date.parse(second.availableAt) - now, 12 * 60 * 60 * 1000);
  assert.equal(Date.parse(providerLimited.availableAt), Date.parse('2026-09-26T12:00:00.000Z'));
  assert.equal(terminal.terminal, true);
});

test('scheduler batches require a configured matching token, while per-book service calls do not', () => {
  const validBatch = { serviceCredential: true, schedulerToken: 'secret', suppliedSchedulerToken: 'secret', requiresSchedulerToken: true };
  assert.equal(hasValidSchedulerCredentials({ ...validBatch, suppliedSchedulerToken: '' }), false);
  assert.equal(hasValidSchedulerCredentials({ ...validBatch, schedulerToken: '' }), false);
  assert.equal(hasValidSchedulerCredentials(validBatch), true);
  assert.equal(hasValidSchedulerCredentials({ ...validBatch, requiresSchedulerToken: false, suppliedSchedulerToken: '' }), true);
  assert.equal(hasValidSchedulerCredentials({ ...validBatch, serviceCredential: false }), false);
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
  assert.match(worker, /requiresSchedulerToken: !bookId|serviceKey, !bookId/);
  assert.match(worker, /status: complete \? 'completed' : terminal \? 'failed' : 'retry'/);
  assert.match(worker, /enrichmentRetryPlan\(job\.attempt_count/);
  assert.match(worker, /status: retry\.terminal \? 'failed' : 'retry'/);
  assert.match(worker, /status: 'not_in_library'/);
  assert.match(content, /serviceCaller[\s\S]*apiKey === serviceKey/);
  assert.match(editions, /serviceCaller[\s\S]*apiKey === serviceKey/);
});
