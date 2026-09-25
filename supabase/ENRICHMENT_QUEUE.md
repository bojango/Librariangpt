# Metadata enrichment queue

`20260923145729_add_metadata_enrichment_queue.sql` makes metadata enrichment independent of the Reading Room browser:

- a `library_entries` insert creates or wakes one job for that Library book; books that are only recommendation/candidate records are never automatically queued;
- removing a `library_entries` row removes its queue job, and claims also verify current Library membership;
- metadata failures and partial results use a capped exponential retry schedule (6h, 12h, 24h, 48h; at most five attempts), while a later `metadata_retry_after` remains authoritative;
- `pg_cron` calls `book-background-enrich` every five minutes;
- the Edge Function claims jobs with `FOR UPDATE SKIP LOCKED` and reuses the existing edition → Goodreads → content orchestration;
- service-only RLS/grants keep queue state out of the public client API.

## Deployment

Before applying the migration, create a high-entropy token in both places:

1. Edge Function secret `ENRICHMENT_SCHEDULER_TOKEN`.
2. Vault secret `enrichment_scheduler_token` with the same value.

The existing Vault secrets `project_url` and `goodreads_scheduler_service_key` are reused for the authenticated `pg_net` request. `GOOGLE_BOOKS_API_KEY` remains optional but recommended for Google Books quota attribution.

Deploy these functions together so the scheduler and its internal service calls agree on authorization and queue behavior:

```text
book-background-enrich
content-enrichment
edition-options
goodreads-rating-refresh
```

Then apply the migration. Its backfill queues unresolved, partial, failed, synopsis-less, and cover-less historical Library records without duplicating jobs. Repeated failures become a terminal `failed` queue state; a forced per-book enrichment request can claim that job again.

## Diagnostics

Inspect `book_enrichment_jobs` for `status`, `attempt_count`, `available_at`, `last_error`, and `last_result`. `cron.job_run_details` and `net._http_response` show scheduler delivery failures. Provider-level Google Books/Open Library diagnostics are stored in each orchestration result.
