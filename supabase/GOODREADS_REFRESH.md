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

## One-time Vault and schedule setup

The migration deliberately does not create a cron job until the two required Vault secrets exist. In the Supabase SQL editor, create them once:

```sql
select vault.create_secret(
  'https://fbbpovieqfsjunmqtxvf.supabase.co',
  'goodreads_refresh_project_url'
);

select vault.create_secret(
  'LEGACY_SERVICE_ROLE_JWT',
  'goodreads_refresh_service_role_key'
);
```

Use the legacy service-role JWT because gateway JWT verification remains enabled. Never commit or paste the value into a migration.

Then create one daily job. It requests at most six due books, and the Edge Function processes them sequentially:

```sql
select cron.schedule(
  'goodreads-rating-refresh-daily',
  '20 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_refresh_project_url') || '/functions/v1/goodreads-rating-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_refresh_service_role_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_refresh_service_role_key')
    ),
    body := '{"batch_size":6}'::jsonb,
    timeout_milliseconds := 180000
  );
  $$
);
```

Before rerunning that statement, check `cron.job` for the job name to avoid a duplicate schedule.

## Safe initial backfill

Invoke the same function with `{ "batch_size": 6 }`. Each invocation selects a fresh, due batch, processes it sequentially, and records retry state. It is safe to rerun, but wait for one invocation to finish before starting another. Stop after one or two batches and let the daily schedule complete the remainder.

After the Vault secrets exist, this SQL performs one batch without exposing the key:

```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_refresh_project_url') || '/functions/v1/goodreads-rating-refresh',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_refresh_service_role_key'),
    'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_refresh_service_role_key')
  ),
  body := '{"batch_size":6}'::jsonb,
  timeout_milliseconds := 180000
);
```

Existing Goodreads mappings are refreshed directly. Failed refreshes keep the last good cached rating and defer the next attempt by 6 hours, 24 hours, then 72 hours.
