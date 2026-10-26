# Collection discovery backend

The additive discovery migration follows the existing pending Collections
migration and verified starter seed. Production application requires separate
review and approval. Do not blindly replay historical migrations against an
existing Supabase project.

Discovery has its own durable queue and attempt log, independently of normal
metadata completion. Canonical book/Library additions, work IDs, authors and
edition identity changes enqueue work, including books outside the Library.
The service-only Edge Function uses the existing Vault scheduler credentials
and pg_cron/pg_net infrastructure. Claims have revision/lease tokens, row locks,
fifteen-minute recovery and five attempts per revision. Provider backoff and
failure history survive worker invocations.

The reviewed registry contains public bibliographic assertions. It matches
underlying works using full author identity, exact titles, source-backed aliases,
work identifiers and valid ISBNs. Provider series hints remain unresolved until
trustworthy membership evidence is reviewed; an empty search never establishes
a standalone. Arbitrary unknown publisher catalogues are not automatically
verified. Catalogue completeness is explicitly scoped, and uncertain numbering
remains null. Update the reviewed source assertions before retrying such cases.

The importer reuses canonical books, work keys, collection keys and corroborated
series UUIDs. It retains existing non-null official positions and reports
conflicts. It only inserts bibliographic catalogue rows and operational state;
it never changes ownership, reading status, editions, reviews, recommendations
or personalised reading paths, or automatically adds catalogue works to Wishlist.

The approved UI layout is retained. Related-book headings continue to resolve by
canonical series IDs; verified catalogue works use the existing catalogue routes.
Starter collections remain visible during partial backend rollout.

## Local verification

```powershell
node scripts/generate-discovery-registry.mjs
# Export scripts/audit-collections.sql read-only to a private/ignored snapshot.
node scripts/backfill-collections.mjs --snapshot output/collections-backend/audit-snapshot.json
npm run check
npm run build
npm test
npm run test:e2e
```

The backfill utility has no production apply mode. It tests the actual migrations
and repeated imports in isolated PostgreSQL. SQL integration uses PGlite; cron is
stubbed and provider tests use controlled HTTP responses. The frontend creation
scenario additionally executes the existing book-add RPC and new discovery SQL
in Chromium and iPhone WebKit. Test results: 420 unit/integration tests passed;
251 full E2E tests passed, with one existing intentional skip. Runtime/build
checks passed. Hosted Vault/JWT/cron behavior needs a staging smoke test.

## Later approved rollout

Refresh and verify a private database backup immediately before deployment. The
backup helper requires PostgreSQL binaries and public trust roots; it captures
temporary CLI credentials internally without printing them. Keep backup archives,
production snapshots and book-by-book coverage evidence outside version control.

On staging, apply the pending Collections migration and reviewed seed, then the
discovery migration. Deploy `collection-discovery` and the updated `related-books`
function using the existing scheduler secrets. Verify actual scheduled execution,
owner permissions, a frontend addition and an edition identity change before a
separately approved production rollout. Deploy the worker before its schedule runs.

As service role, `select public.reconcile_collection_discovery();` queues missing
canonical books without resetting current retry budgets or deadlines. The worker
drains two books every five minutes by default, with at most four per invocation.
After additional source evidence is reviewed,
`select public.reconcile_collection_discovery(true);` retries unresolved/failed
jobs. Inspect both job and attempt tables. If problems arise, pause the new cron
job and retain the additive tables and logs; do not delete reader data or valid
legacy memberships. No merge into main is required.
