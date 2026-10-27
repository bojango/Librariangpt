# Collection enrichment and Librarian assessments

Catalogue metadata does not require a canonical book or a Library entry. The
`catalogue-enrichment` Edge Function fills missing fields, reuses canonical and
cached provider metadata and the verified author artwork registry, and validates
actual image bytes and dimensions. Exact title and full author identity are
required. Existing nonempty metadata and selected covers survive. Provider
failures remain diagnostic evidence, never invented book facts.

The server-side reviewed artwork cache also includes publisher-distributed
edition images. New cache entries retain the exact reviewed title and authors;
identity mismatch rejects them. Storefront social banners and interior artwork
are excluded. Apple edition CDN images can be verified independently of search
API quota. This adds no AI service or frontend credential.
Known validated ISBNs also provide up to two Open Library edition-cover
candidates before any catalogue search. All cover routes reject known logos,
social previews, interior-image URLs and wide banners. Reviewed cache assets
are visually checked against the book title and author before publication.

`catalogue_enrichment_jobs` is independent of Library metadata and discovery.
New catalogue rows enqueue automatically. Leases expire after fifteen minutes;
claim tokens and identity hashes reject stale writes. Retries use 6/12/24/48-hour
backoff and a thirty-day follow-up after five attempts. Shared provider circuits
and Retry-After deadlines take precedence. Each invocation processes at most two
works with bounded requests, redirects, response sizes and provider time budgets.
Complete jobs can be deliberately queued again for artwork verification; normal
reconciliation does not reset completed jobs or retry budgets.

Assessments are keyed by `(user_id, work_key)`. Canonical association belongs to
the existing catalogue row, so adding a work to Wishlist preserves its assessment.
No assessment code writes books, Library entries, recommendations, dismissals or
reading paths. Prior assessments are retained in private history. A failed
reassessment preserves the previous assessment and displays a pending note.

The secure inference route reuses the existing trusted Librarian connector
workflow. Only the authenticated Supabase SQL connector's `postgres` role can
claim or publish assessments; browser and service-role REST clients cannot.
There is no AI API credential, fixed score generator, template verdict or new
paid AI provider. Scheduled Codex review uses the account's existing allowance;
availability depends on the local app/host, account limits and connector access.
Do not claim an always-on cloud AI service. The metadata cron runs in Supabase
independently of this local inference runner.

The active `Collection Librarian` heartbeat checks this thread every six hours,
claiming at most twelve books per run. Routine empty checks perform no external
AI API requests. The deployment does not buy credits or introduce AI API billing.
When a reviewed official source supplies a missing description, the trusted
connector may call `record_catalogue_source_summary(work_key,title,authors,
source_url,summary)`. It checks identity and fills only an empty synopsis, with
explicit provenance. Reconcile and obtain a fresh claim after recording new
content; old claims must not be forced through. Artwork-only source additions
are excluded from the assessment fingerprint.
Unused provider descriptions also remain excluded: finding an edition cover
does not promote an unselected description into material assessment evidence.
After retaining source summaries, the trusted reviewer runs
`supabase/operations/reconcile-reviewed-catalogue-metadata.sql`. It marks metadata
complete only when a description, year and verified cover are already present,
records that no provider request occurred, and preserves attempt budgets and
all retry deadlines. Unfinished and currently leased work remains retryable.

`collection_librarian_candidates(4)` returns leased work evidence, collection
positions and the owner's canonical Taste Profile, actual feedback, ratings,
reading history, taste evidence and historical recommendations. Review each
book's supported characteristics. Publish with
`publish_collection_assessment(work_key, claim_token, taste_version, assessment)`.
The JSON assessment contains `verdict` (`recommended`, `optional`,
`not_recommended`, `pending`), `appeal`, `frustrations`, `reasoning`, `continuity`,
`confidence` (`Low`, `Medium`, `High`), `evidence` (source_url/detail objects),
`taste_evidence_ids` and `inference_provenance`. Only recommended books have a
required `match_score_10`. Pending results require a specific `pending_reason`.
Scores express an evidenced forecast, not a mathematical estimate from genre.
Do not infer a positive match from author/series membership. Explain negative
verdicts, separate continuity from enjoyment, and avoid spoilers.

Claims expire after thirty minutes. Publication rejects changed source content,
changed taste evidence, expired leases and duplicate receipts. Substantive taste,
qualitative feedback, reviews, ratings and reading-state changes alter a stable
evidence fingerprint; timestamps, page progress, confidence/evidence counters,
cosmetic edits and repeated feedback do not. Material taste changes settle for
six hours before a new version is activated. Source content changes queue their
affected work independently. The scheduled metadata worker reconciles both
queues; the Librarian runner also reconciles before claiming.

The existing row/detail styles are reused. Full Collection shows every verdict
and an expandable reasoning section, including pending and negative results.
Positive assessments supply Suggested Reads. A saved path continues using the
reader's own positions, selections and notes. Assessments never edit that path.

Deployment is additive and staged: verified fresh private backup; isolated
production-snapshot migration and protected-row fingerprints; full tests; schema;
worker deployment; one real hosted smoke invocation; separate cron activation;
then frontend deployment from the existing feature branch. A failed smoke test
must stop activation. Pause only the new cron/runner if a critical issue occurs.
Never replay historical migrations or delete reader data to undo this feature.

Private reproduction:

```powershell
node scripts/backup-collections.mjs --directory output/private-collection-intelligence-backup --tools output/postgresql-tools/pgsql/bin
node scripts/collection-intelligence-snapshot.mjs
node scripts/verify-collection-intelligence-snapshot.mjs
npm run check
npm run build
npm test
npm run test:e2e
```

The snapshot test restores actual production catalogue/reader rows into isolated
PostgreSQL and verifies unchanged protected fingerprints. Its legacy fixture
nulls edition-only foreign keys, omits unavailable historical schema columns and
accepts the deployed NFC progress source. Its report records the restored
columns. Production edition references remain untouched. Hosted cron/net/Vault
execution requires a real post-deployment check.
