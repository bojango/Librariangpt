-- Forward-only Goodreads resolver diagnostics and scheduler capacity hardening.

alter table public.rating_refresh_state
  add column if not exists last_resolution_tier text,
  add column if not exists last_resolution_diagnostic jsonb not null default '{}'::jsonb;

alter table public.rating_refresh_state
  drop constraint if exists rating_refresh_state_resolution_tier_check;
alter table public.rating_refresh_state
  add constraint rating_refresh_state_resolution_tier_check
  check (last_resolution_tier is null or last_resolution_tier in ('ISBN_CONFIRMED', 'WORK_CONFIRMED', 'UNRESOLVED'));

create or replace function public.select_due_goodreads_rating_books(p_limit integer default 8)
returns table(book_id uuid, mapping_known boolean, due_reason text)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select
      b.id as book_id,
      (gr.id is not null) as mapping_known,
      case when gr.id is not null then 'stale_mapping' else 'discovery_due' end as due_reason,
      gr.fetched_at,
      rs.last_attempted_at,
      b.created_at
    from public.books b
    left join lateral (
      select pr.id, pr.fetched_at
      from public.public_ratings pr
      where pr.book_id = b.id and lower(pr.provider) = 'goodreads'
      order by pr.fetched_at desc
      limit 1
    ) gr on true
    left join public.rating_refresh_state rs
      on rs.book_id = b.id and rs.provider = 'Goodreads'
    where (
      gr.id is not null
      and gr.fetched_at < now() - interval '7 days'
      and (rs.next_retry_at is null or rs.next_retry_at <= now())
    ) or (
      gr.id is null
      and (rs.next_retry_at is null or rs.next_retry_at <= now())
    )
  )
  select c.book_id, c.mapping_known, c.due_reason
  from candidates c
  order by
    case when c.mapping_known then 0 else 1 end,
    case when c.mapping_known then c.fetched_at end asc nulls first,
    c.last_attempted_at asc nulls first,
    c.created_at asc
  limit least(greatest(coalesce(p_limit, 8), 1), 8)
$$;

revoke all on function public.select_due_goodreads_rating_books(integer) from public, anon, authenticated;
grant execute on function public.select_due_goodreads_rating_books(integer) to service_role;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'goodreads-rating-refresh-twice-daily';
  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
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
      body := '{"batch_size":8}'::jsonb,
      timeout_milliseconds := 90000
    );
  $schedule$
);
