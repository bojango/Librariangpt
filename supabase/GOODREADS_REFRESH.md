# Goodreads rating refresh deployment

Goodreads ratings are fetched only by the authenticated `goodreads-rating-refresh` Edge Function. The browser reads cached data from Supabase and may request a due refresh, but it never contacts Goodreads directly.

## Deploy

Apply the migration, then deploy all functions whose responsibilities changed:

```powershell
npx supabase@latest link --project-ref fbbpovieqfsjunmqtxvf
npx supabase@latest db push
npx supabase@latest functions deploy goodreads-rating-refresh content-enrichment book-background-enrich --project-ref fbbpovieqfsjunmqtxvf --use-api
```

Keep JWT verification enabled for `goodreads-rating-refresh` (the default). Do not deploy it with `--no-verify-jwt`.

## Automated schedule

The forward corrective migrations enable `pg_cron` and `pg_net` and create the idempotent `goodreads-rating-refresh-twice-daily` job. It runs at 00:17 and 12:17 UTC, requests at most six due books, and the Edge Function processes them sequentially. That provides 84 attempts per week.

Gateway JWT verification remains enabled. Scheduled batch calls also require a dedicated high-entropy `GOODREADS_SCHEDULER_TOKEN`. Its matching value and the platform service credential live only in Edge secrets and Vault under `goodreads_scheduler_token` and `goodreads_scheduler_service_key`; migrations contain names only, never values.

## Safe initial backfill

Invoke the same function with `{ "batch_size": 6 }`. Each invocation selects a fresh, due batch, processes it sequentially, and records retry state. It is safe to rerun, but wait for one invocation to finish before starting another. Stop after one or two batches and let the daily schedule complete the remainder.

This SQL performs one batch through the same secured scheduler path without exposing either credential:

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/goodreads-rating-refresh',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_scheduler_service_key'),
    'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_scheduler_service_key'),
    'x-goodreads-scheduler-token', (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_scheduler_token')
  ),
  body := '{"batch_size":6}'::jsonb,
  timeout_milliseconds := 90000
);
```

Existing Goodreads mappings are refreshed directly. Failed refreshes keep the last good cached rating and defer the next attempt by 6 hours, 24 hours, then 72 hours.
