-- Require a dedicated high-entropy scheduler token in addition to the platform
-- API credential. Both values are resolved from Vault at execution time.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'goodreads-rating-refresh-twice-daily';
  if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
end
$$;

select cron.schedule(
  'goodreads-rating-refresh-twice-daily',
  '17 0,12 * * *',
  $schedule$
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
  $schedule$
);
