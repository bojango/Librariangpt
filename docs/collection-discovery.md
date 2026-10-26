# Collection discovery backend

The pending Collections foundation, seed, discovery migration and automation
hardening migration are additive. Production application and backend deployment
require separate approval. These migrations never activate the discovery cron.
Do not replay historical migrations blindly against an existing project.

## Discovery and verification

Discovery has its own durable queue and attempt history, independent of normal
metadata completion. Every canonical book is covered, including records outside
Library. Book creation, Library addition, authorship and work/edition identity
changes enqueue discovery. Claims prioritise Library books, use revision/lease
tokens and row locks, recover after fifteen minutes, and allow five attempts per
revision. Provider failures retain diagnostics and Retry-After deadlines. Each
book has a twenty-second provider budget, each request at most 6.5 seconds, with
bounded redirects, response size and catalogue pagination.

The worker first matches the reviewed registry and existing verified database
catalogues by full author identity, exact titles, reviewed aliases, underlying
work IDs and valid ISBNs. Existing provider metadata is reused. Unknown books
can produce Google Books series/membership candidates or Open Library hints.
Candidates persist in the job result for review; neither a missing series field
nor an empty search proves a standalone.

First-party publisher URLs already obtained during enrichment can also establish
new collections automatically. The bounded adapter accepts explicit BookSeries
JSON-LD on approved HTTPS publisher hosts, including linked series pages. It
requires an exact title/author match and at least two distinct works. It never
infers numbering from list position. A declared matching total is required for
completeness. Publisher imprints, box sets, duplicate works/positions, unrelated
authors, untrusted redirects and oversized responses are rejected. An arbitrary
unknown website or prose-only page is not automatically promoted to authority.

Verified provider catalogues are persisted in service-managed
`collection_source_catalogues` and reused on subsequent discoveries. A later
service verification/update automatically requeues affected unresolved books.
After code-source changes, the content-hashed registry revision causes one
recheck of completed, unresolved and failed books. This includes completed series
that gain new volumes. Repeated invocations with the same revision do not reset
retry deadlines or attempts. Processing and provider-retry jobs remain fenced.

For manual source verification, retain the candidate in `result.candidates`,
verify its work identity, membership, numbering and scope, then store the
reviewed `{works: [...], collections: [...]}` bibliography with
`status='verified'`, `source_url` and `verified_at` as service role. Candidate or
rejected sources are never used as verified catalogues. Browser roles cannot
write source assertions or invoke discovery/import/registry RPCs.

## Catalogue and reader safety

The atomic importer reuses canonical books, work keys, collection keys and
corroborated legacy series UUIDs, including verified name aliases. Existing
non-null positions are retained; conflicting evidence is logged for review.
Different authors and ambiguous canonical/series identities stay separate.
Additional volumes are bibliography rows, never automatic Wishlist additions.
No discovery path changes ownership, reading status, selected editions, reviews,
recommendations, reading paths or their order. Official order remains independent
of personalised reading paths. Owner-scoped RLS remains in force.

Completeness is explicitly scoped. Incomplete catalogues carry a visible label;
deliberately limited core catalogues use `catalogue_type='limited'`. Beacon 23
uses `serialized_novel`: its metadata and legacy membership are retained, its
five serial parts are counted as one novel, and no one-book collection card or
series-heading link is presented. Other one-book incomplete collections remain
visible pending correction. The full Expanse, Rama, Ready Player, Sand, Children
of Time, Hitchhiker's Guide and Thursday Murder Club sequences have isolated SQL
and browser checks. Author collections remain a distinct optional view.

The approved layout and CSS are unchanged. Canonical collection IDs drive
related-books headings and work routes; alias reconciliation prevents duplicate
starter cards. The existing visible-page scheduler refreshes collection data on
book/collection pages and on resume, including after background discovery.
Draft reading paths are protected from background refresh, and a temporary read
failure retains the previously loaded catalogue.

## Local verification and private evidence

```powershell
node scripts/generate-discovery-registry.mjs
# Export scripts/audit-collections.sql read-only to a private/ignored snapshot.
node scripts/backfill-collections.mjs --snapshot output/private-audit.json --out output/private-report
# Optional: --reviews output/private-individual-reviews.json
npm run check
npm run build
npm test
npm run test:e2e
```

The backfill utility has no production apply mode. It executes the actual
migrations and repeated imports in isolated PostgreSQL/PGlite, including Library
status/ownership rows when supplied. Reports include per-book outcomes, Library
versus additional-catalogue coverage, every singleton, catalogue scopes and
protected-data fingerprints. They contain private reader evidence and must
remain ignored. Preserve the original review inventory when supplying individual
reviews; do not publish it in the public repository.

SQL integration tests cover migration scheduling isolation, RLS, fenced claims,
retry deadlines, provider/source verification, idempotency, duplicate prevention
and reader/recommendation/path preservation. Actual Edge handlers use controlled
HTTP responses. Chromium and iPhone WebKit tests execute the existing add-book
RPC and discovery SQL, including a previously unknown series and automatic UI
refresh. The full checks passed: 435 unit/integration tests and 255 E2E tests,
with one existing intentional E2E skip. Hosted Vault/JWT/network/cron behavior
still requires a separately authorised staging smoke test.

## Separate rollout and activation

1. Refresh and verify a private database backup immediately before deployment.
   Review a fresh production dry-run, unresolved cases and catalogue scopes.
   Keep backups, snapshots and coverage inventories outside version control.
2. On an approved staging target, apply the pending Collections migration and
   reviewed seed, then both discovery migrations. Assert that no
   `collection-discovery-every-five-minutes` cron job exists.
3. Deploy `collection-discovery` and the updated `related-books` function with
   the existing Vault service/scheduler secrets. Deployment alone starts no job.
4. Make an explicit service/scheduler invocation with
   `{"book_id":"<test canonical UUID>","batch_size":1,"smoke_test":true}`.
   Inspect the job, attempts and resulting catalogue, plus frontend addition,
   edition-change and owner/foreign/anonymous permission behavior. Only an
   explicitly requested single-book invocation whose database outcome is
   completed records `collection_worker_smoke` evidence. The revision is the
   hosted `DENO_DEPLOYMENT_ID`, so a redeploy requires a fresh smoke test, not a
   manually maintained version constant. See [Supabase environment variables](https://supabase.com/docs/guides/functions/secrets).
5. After reviewing that deployed revision, explicitly set
   `readingroom.approved_collection_worker_revision` to its recorded revision
   and run `supabase/operations/activate-collection-discovery.sql`. This is an
   administrator operation outside migrations. It rejects missing, stale or
   mismatched smoke evidence. Verify actual hosted scheduled execution.
6. A separately approved production rollout repeats these steps. No merge into
   main is needed. Service `reconcile_collection_discovery()` queues missing
   books without resetting live jobs. The activated worker drains two books
   every five minutes, at most four per invocation. The explicit
   `reconcile_collection_discovery(true)` retry remains available after manual
   review; source and registry verification also reprocess cases automatically.

If problems arise, unschedule only the discovery job and retain the additive
tables, attempt logs, reader data and valid legacy memberships. Neither worker
deployment nor cron activation has been performed as part of this hardening pass.
