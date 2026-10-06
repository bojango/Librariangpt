# Library enrichment

`library_entries` is the ingestion boundary. Its database insert/book reassignment
trigger enqueues incomplete metadata and creates missing Goodreads retry state.
Frontend additions, direct DB/ChatGPT additions, and existing books added later
use this same hook. Books outside Library cannot be claimed by either scheduler.

The existing five-minute metadata worker runs edition discovery, Goodreads, then
content enrichment. A Goodreads ISBN bootstrap may request another edition pass;
that pass avoids repeating a Google title query. A completed metadata job means
core metadata is present, independently of Goodreads. Goodreads failures never
prevent otherwise valid metadata from resolving.

Metadata retries wait 6, 12, 24, then 48 hours. From attempt five onward, incomplete
or failed runs enter `deferred` and retry seven days later. A later provider/book
deadline wins. Attempt counts are retained. Claims keep the existing row locks,
`SKIP LOCKED`, Library check, and fifteen-minute abandoned-worker recovery.
Reconciliation does not reset active jobs, retry deadlines, or deferred cadence.

Goodreads keeps its separate `rating_refresh_state` claim/backoff (6h, 24h, then
72h) and seven-day cache TTL. The eight-book twice-daily selector prioritises
missing ratings/mappings, due failed resolutions, then stale successful mappings.
Refresh failures retain the previous rating and confirmed mapping. A mapping may
be stored in `rating_refresh_state.provider_book_id/source_url` before a rating is
available; successful ratings also retain their existing `public_ratings` mapping.

Discovery uses persisted Goodreads identity first, then an ISBN redirect, explicit
IDs/URLs in trusted provider evidence, and finally Goodreads search HTML using
ISBN or title plus primary author. Every fetched page, including a persisted ID,
must pass the existing ISBN/work identity guard. Initials remain supported, but
different full first names sharing an initial are rejected. Requests are bounded
and transient search failures no longer abort the remaining discovery routes.
Fresh ratings bootstrap metadata only from cached evidence without extra HTTP.

Edition/content stages reuse `editions.metadata_payload`. Google ISBN lookup
precedes broad searches, and discovery/content avoid repeating Google queries.
Content can still make a targeted ISBN request for a missing synopsis when edition
discovery found sufficient Open Library identity and did not query Google. Open
Library fills edition/work gaps when Google is unavailable. Google 429 opens the
provider-wide circuit in `enrichment_provider_state`: Retry-After (minimum one
minute), or 45 minutes when absent. Each Google call checks it immediately before
network access. Diagnostics retain HTTP failures, skipped calls and reused evidence.

`reconcile_library_enrichment()` runs at **00:07 and 12:07 UTC**, before Goodreads
at 00:17/12:17. It requeues incomplete Library metadata and creates missing due
Goodreads state without changing metadata, editions, ratings, locks, or retry
deadlines. The migration invokes it once for historical backfill. It is safe to
repeat as service role or an administrator:

```sql
select public.reconcile_library_enrichment();
select * from public.v_library_enrichment_health;
```

The service-only health view derives `metadata_complete`, `goodreads_complete`,
their retry-due flags, and `fully_enriched`. Metadata core means a credible selected
current/reference edition, nonblank synopsis, HTTP(S) cover URL, and a page total
(audio editions are exempt). Verified/locked identity can be credible without an
ISBN. Publisher, year, format and ISBN are filled where available, but optional
absence does not block completion. Cover usability is a stored URL check, not a
fresh image download. Goodreads completeness requires a mapped rating with count
and a fetch within seven days. State/status fields remain canonical; the view does
not store another copy of completion state.

Updates fill missing fields only. Manual metadata status, existing synopsis and
edition values, current/reference selection, locked/exact-copy identity, verified
page counts, selected/locked covers and uploaded covers remain protected. An
incomplete locked record can continue on weekly retries without changing its
protected fields; deliberate owner corrections may be necessary.

## Deployment order (not performed by this change)

1. Validate on an isolated development database with the existing migration
   history. Run `npm test`, `npm run check`, `npm run build`, and the E2E suite.
   The local SQL tests use real PostgreSQL in PGlite; cron is recorded through a
   stub and HTTP providers are mocked. Verify actual pg_cron/Vault/Edge execution
   on staging before production rollout. Historical bootstrap migrations contain
   redacted deployment values; do not blindly replay them against production.
2. For a later approved production rollout, temporarily pause
   `book-metadata-enrichment-every-five-minutes` and
   `goodreads-rating-refresh-twice-daily`; allow active claims to finish. Avoid
   foreground enrichment calls during this brief function rollout.
3. Apply **20261006200850_harden_library_enrichment.sql** transactionally. It adds
   deferred support, provider circuit storage, mapping columns, health/queue RPCs,
   an idempotent backfill, and `library-enrichment-reconciliation-twice-daily`.
   It does not change either existing worker schedule or rewrite book data.
4. Redeploy **edition-options**, then **content-enrichment**, then
   **goodreads-rating-refresh**, then **book-background-enrich** from this commit,
   including their changed shared modules. Preserve existing JWT configuration
   and configured scheduler tokens. No new credentials are required.
5. As service role, repeat reconciliation; inspect the health view, selector,
   deferred jobs and provider circuit. Smoke-test a direct DB Library insertion
   and a frontend add in staging, plus a locked edition and Goodreads failure.
6. Resume the existing five-minute metadata and twice-daily Goodreads jobs.
   Confirm the new reconciliation schedule is active, then inspect actual cron
   run results, function diagnostics and retry deadlines. No merge or deployment
   is performed by this repository change.

If a rollout needs to be stopped, pause workers and retain the additive schema
and existing data for diagnosis. Older workers do not understand deferred jobs;
do not restore them while expecting the new retry guarantees.

Goodreads may still return 202/403/429, verification pages, or no structured rating.
An ISBN redirect is an opportunistic public web route, not a guaranteed API.
Missing or ambiguous canonical identity remains unresolved rather than accepting
a title-only match. Confirmed but unavailable pages retry; providers cannot be
made to publish missing data. Concurrent requests already in flight when a 429
arrives cannot be cancelled by the shared circuit. Low-priority stale mappings
can wait behind a large backlog of new books at the existing eight-book capacity.
