import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProviderJson, googleRetryAfter, openLibraryPageCount, parseRetryAfter, providerDiagnostics, recordZeroResult } from '../../supabase/functions/_shared/provider-fetch.js';
import { readFile } from 'node:fs/promises';

test('Open Library page count prefers number_of_pages and safely parses pagination only', () => {
  assert.equal(openLibraryPageCount(320, '288'), 320);
  assert.equal(openLibraryPageCount(null, '320'), 320);
  assert.equal(openLibraryPageCount(null, '320 p.'), 320);
  assert.equal(openLibraryPageCount(null, '288 pages'), 288);
  assert.equal(openLibraryPageCount(null, 'xii, 320 pages'), null);
  assert.equal(openLibraryPageCount(null, '320-330'), null);
});

test('provider diagnostics distinguish a valid zero-result response from HTTP failure', async () => {
  const originalFetch = globalThis.fetch;
  const diagnostics = providerDiagnostics();
  globalThis.fetch = async url => String(url).includes('zero')
    ? new Response(JSON.stringify({ items: [] }), { status: 200 })
    : new Response('unavailable', { status: 503 });
  try {
    const zero = await fetchProviderJson('https://www.googleapis.com/books/v1/volumes?zero', 20, diagnostics);
    assert.deepEqual(zero, { items: [] });
    recordZeroResult(diagnostics, 'google_books');
    assert.equal(await fetchProviderJson('https://www.googleapis.com/books/v1/volumes?down', 20, diagnostics), null);
    assert.deepEqual(diagnostics.google_books.http_errors, [503]);
    assert.equal(diagnostics.google_books.successful, 1);
    assert.equal(diagnostics.google_books.zero_result_queries, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test('a Google 429 trips the per-run circuit and honours Retry-After', async () => {
  const originalFetch = globalThis.fetch;
  const diagnostics = providerDiagnostics();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('rate limited', { status: 429, headers: { 'Retry-After': '120' } }); };
  try {
    assert.equal(await fetchProviderJson('https://www.googleapis.com/books/v1/volumes?q=first', 20, diagnostics), null);
    assert.equal(await fetchProviderJson('https://www.googleapis.com/books/v1/volumes?q=second', 20, diagnostics), null);
    assert.equal(calls, 1);
    assert.equal(diagnostics.google_books.rate_limited, true);
    assert.equal(diagnostics.google_books.skipped_due_to_rate_limit, 1);
    assert.equal(diagnostics.google_books.retry_after_seconds, 120);
    assert.match(googleRetryAfter(diagnostics, Date.UTC(2026, 0, 1)), /^2026-01-01T00:02:00/);
    assert.match(googleRetryAfter(providerDiagnostics(), Date.UTC(2026, 0, 1)), /^2026-01-01T00:45:00/);
    assert.equal(parseRetryAfter('not-a-date'), null);
  } finally { globalThis.fetch = originalFetch; }
});

test('content enrichment uses a capped set of credible same-work ISBNs without changing reference selection', async () => {
  const source = await readFile(new URL('../../supabase/functions/content-enrichment/index.ts', import.meta.url), 'utf8');
  assert.match(source, /credibleIsbns[\s\S]*\.slice\(0, 3\)/);
  assert.match(source, /const queries: string\[\] = \[\.\.\.credibleIsbns\.map/);
  assert.match(source, /googleCandidate\(item, title, author, credibleIsbns/);
  assert.match(source, /reference_edition_id/);
});

test('rate-limited Google plans are serial, back off, and preserve ready editions', async () => {
  const [content, editions, background] = await Promise.all([
    readFile(new URL('../../supabase/functions/content-enrichment/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/functions/edition-options/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../supabase/functions/book-background-enrich/index.ts', import.meta.url), 'utf8')
  ]);
  assert.match(content, /for \(const query of queries\)/);
  assert.match(content, /if \(diagnostics\.google_books\.rate_limited\) break/);
  assert.match(content, /metadata_retry_after[\s\S]*googleRetryAfter/);
  assert.match(content, /!coreResult\.data\.cover_locked && !coreResult\.data\.cover_url_preferred/);
  assert.match(editions, /if \(diagnostics\.google_books\.rate_limited \|\| googleCount > 0\) break/);
  assert.match(background, /exists\.data\.editions_status !== 'ready'/);
});

test('confirmed Goodreads JSON-LD may provide a last-resort cover and description', async () => {
  const source = await readFile(new URL('../../supabase/functions/goodreads-rating-refresh/index.ts', import.meta.url), 'utf8');
  assert.match(source, /cacheGoodreadsFallbackEvidence/);
  assert.match(source, /provider: PROVIDER/);
  const parser = await readFile(new URL('../../supabase/functions/_shared/goodreads.js', import.meta.url), 'utf8');
  assert.match(parser, /image:/);
  assert.match(parser, /description:/);
});

test('fresh Goodreads ratings can bootstrap a missing ISBN identity once', async () => {
  const source = await readFile(new URL('../../supabase/functions/goodreads-rating-refresh/index.ts', import.meta.url), 'utf8');
  assert.match(source, /identityBootstrapNeeded/);
  assert.match(source, /'fresh_identity_bootstrap'/);
  assert.match(source, /!editions\.some\(row => cleanIsbn/);
});
