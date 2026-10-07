-- Follow-up hardening after live enrichment rollout.
-- Goodreads failures keep their own backoff state, so running the selector hourly
-- improves retry latency without hammering books that are not yet due.
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'goodreads-rating-refresh-twice-daily'
  limit 1;

  if v_job_id is not null then
    perform cron.alter_job(v_job_id, schedule := '17 * * * *');
  end if;
end;
$$;

-- The initial rollout inherited high attempt counts from historical Google Books
-- 429s. Bring those rows back from weekly deferral so the new rate-limit-specific
-- cadence can take over. No book metadata is rewritten here.
update public.book_enrichment_jobs
set status = 'retry',
    available_at = now(),
    locked_at = null,
    completed_at = null,
    updated_at = now()
where status in ('retry','deferred')
  and coalesce(last_error, '') ilike '%rate limit%';
