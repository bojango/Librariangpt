-- Forward hardening only: no book/edition/rating values are rewritten.
alter table public.book_enrichment_jobs drop constraint if exists book_enrichment_jobs_status_check;
alter table public.book_enrichment_jobs add constraint book_enrichment_jobs_status_check
  check (status in ('queued','processing','retry','deferred','completed','failed'));
drop index if exists public.book_enrichment_jobs_due_idx;
create index book_enrichment_jobs_due_idx on public.book_enrichment_jobs(available_at, created_at)
  where status in ('queued','retry','deferred');

-- Provider-wide circuit survives separate Edge invocations and resolved books.
create table if not exists public.enrichment_provider_state (
  provider text primary key check (provider = 'google_books'),
  retry_after timestamptz not null,
  diagnostic jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.enrichment_provider_state enable row level security;
revoke all on public.enrichment_provider_state from public, anon, authenticated;
grant select, insert, update on public.enrichment_provider_state to service_role;

create or replace function public.extend_enrichment_provider_backoff(
  p_provider text, p_retry_after timestamptz, p_diagnostic jsonb default '{}'::jsonb
) returns void language sql security invoker set search_path = '' as $$
  insert into public.enrichment_provider_state(provider, retry_after, diagnostic)
  values(p_provider, greatest(p_retry_after, now() + interval '1 minute'), p_diagnostic)
  on conflict(provider) do update set
    retry_after = greatest(public.enrichment_provider_state.retry_after, excluded.retry_after),
    diagnostic = excluded.diagnostic, updated_at = now();
$$;
revoke all on function public.extend_enrichment_provider_backoff(text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.extend_enrichment_provider_backoff(text,timestamptz,jsonb) to service_role;

-- Mapping can be confirmed even when structured rating data is unavailable.
alter table public.rating_refresh_state
  add column if not exists provider_book_id text,
  add column if not exists source_url text;

create or replace function private.library_metadata_complete(p_book_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce((select
    e.id is not null and e.book_id = b.id
    and (e.exact_copy_verified or e.identity_locked
      or private.is_valid_isbn(e.isbn13) or private.is_valid_isbn(e.isbn10)
      or nullif(btrim(e.open_library_edition_id),'') is not null
      or nullif(btrim(e.google_books_volume_id),'') is not null)
    and nullif(btrim(b.synopsis),'') is not null
    and coalesce(nullif(btrim(e.cover_url),''), nullif(btrim(b.cover_url_preferred),'')) ~ '^https?://'
    and (coalesce(le.total_pages,e.page_count) > 0
      or coalesce(e.format,'') ~* 'audio|audible|cassette|compact disc')
    from public.books b join public.library_entries le on le.book_id = b.id
    left join public.editions e on e.id = coalesce(le.current_edition_id,b.reference_edition_id)
    where b.id = p_book_id), false);
$$;
revoke all on function private.library_metadata_complete(uuid) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.library_metadata_complete(uuid), private.is_valid_isbn(text), private.clean_isbn(text) to service_role;

create or replace view public.v_library_enrichment_health with (security_invoker = true) as
with health as (
  select b.id as book_id, b.metadata_status,
    private.library_metadata_complete(b.id) as metadata_complete,
    coalesce(gr.rating_5 is not null and gr.rating_count > 0
      and (nullif(gr.provider_book_id,'') is not null or nullif(gr.source_url,'') is not null)
      and gr.fetched_at >= now() - interval '7 days', false) as goodreads_complete,
    (nullif(gr.provider_book_id,'') is not null or nullif(gr.source_url,'') is not null
      or nullif(rs.provider_book_id,'') is not null or nullif(rs.source_url,'') is not null) as goodreads_mapping_known,
    gr.fetched_at as goodreads_fetched_at, rs.failure_count as goodreads_failure_count,
    rs.next_retry_at as goodreads_next_retry_at,
    job.status as metadata_job_status, job.available_at as metadata_available_at,
    coalesce(job.available_at,b.metadata_retry_after,now()) <= now()
      and (job.status is distinct from 'processing' or job.locked_at is null
        or job.locked_at < now() - interval '15 minutes') as metadata_retry_due
  from public.books b join public.library_entries le on le.book_id = b.id
  left join public.book_enrichment_jobs job on job.book_id = b.id
  left join public.rating_refresh_state rs on rs.book_id = b.id and rs.provider = 'Goodreads'
  left join lateral (
    select pr.* from public.public_ratings pr
    where pr.book_id = b.id and lower(pr.provider) = 'goodreads'
    order by pr.fetched_at desc nulls last limit 1
  ) gr on true
)
select book_id, metadata_status, metadata_complete, goodreads_complete,
  metadata_retry_due and not metadata_complete as metadata_retry_due,
  not goodreads_complete and coalesce(goodreads_next_retry_at,now()) <= now() as goodreads_retry_due,
  metadata_complete and goodreads_complete as fully_enriched,
  goodreads_mapping_known, goodreads_fetched_at, goodreads_failure_count, goodreads_next_retry_at,
  metadata_job_status, metadata_available_at
from health;
revoke all on public.v_library_enrichment_health from public, anon, authenticated;
grant select on public.v_library_enrichment_health to service_role;

-- Preserve in-flight jobs and every existing retry deadline. Reconciliation may
-- revive completed/legacy failed jobs, but cannot turn deferred work into a hot loop.
create or replace function private.enqueue_library_metadata(p_book_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_changed integer;
begin
  if not exists(select 1 from public.library_entries where book_id = p_book_id) then return false; end if;
  if private.library_metadata_complete(p_book_id) then
    update public.book_enrichment_jobs set status = 'completed', locked_at = null,
      completed_at = coalesce(completed_at,now()), last_error = null
    where book_id = p_book_id and status not in ('completed','processing');
    return false;
  end if;
  insert into public.book_enrichment_jobs(book_id,status,available_at,last_error)
  select b.id, case when b.metadata_retry_after > now() then 'retry' else 'queued' end,
    greatest(coalesce(b.metadata_retry_after,now()),now()), b.metadata_error
  from public.books b where b.id = p_book_id
  on conflict(book_id) do update set
    status = case when public.book_enrichment_jobs.attempt_count >= 5 then 'deferred' else excluded.status end,
    available_at = greatest(excluded.available_at,
      case when public.book_enrichment_jobs.attempt_count >= 5
        then coalesce(public.book_enrichment_jobs.last_attempted_at,now()) + interval '7 days'
        else now() end),
    locked_at = null, completed_at = null, updated_at = now()
  where public.book_enrichment_jobs.status in ('completed','failed');
  get diagnostics v_changed = row_count;
  return v_changed > 0;
end;
$$;
revoke all on function private.enqueue_library_metadata(uuid) from public, anon, authenticated;

create or replace function private.sync_book_enrichment_queue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.metadata_status = 'resolving' then return new; end if;
  perform private.enqueue_library_metadata(new.id);
  return new;
end;
$$;

create or replace function private.wake_book_enrichment_queue_for_library_entry()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.enqueue_library_metadata(new.book_id);
  insert into public.rating_refresh_state(book_id,provider,next_retry_at)
  select new.book_id,'Goodreads',coalesce(
    (select max(fetched_at) + interval '7 days' from public.public_ratings
      where book_id = new.book_id and lower(provider) = 'goodreads'),now())
  on conflict(book_id,provider) do nothing;
  return new;
end;
$$;
revoke all on function private.sync_book_enrichment_queue(), private.wake_book_enrichment_queue_for_library_entry() from public, anon, authenticated;

-- Library insert remains authoritative. Reassignments through DB clients also wake work.
drop trigger if exists library_entries_wake_metadata_queue on public.library_entries;
create trigger library_entries_wake_metadata_queue after insert or update of book_id on public.library_entries
for each row execute function private.wake_book_enrichment_queue_for_library_entry();

create or replace function public.claim_book_enrichment_jobs(
  p_limit integer default 2, p_book_id uuid default null, p_force boolean default false
) returns table(job_id uuid, book_id uuid, attempt_count integer)
language sql security definer set search_path = '' as $$
  with candidates as (
    select job.id from public.book_enrichment_jobs job
    where (p_book_id is null or job.book_id = p_book_id)
      and exists(select 1 from public.library_entries le where le.book_id = job.book_id)
      and ((p_force and job.status <> 'processing')
        or (job.status in ('queued','retry','deferred') and job.available_at <= now())
        or (job.status = 'processing' and (job.locked_at is null or job.locked_at < now() - interval '15 minutes')))
    order by job.available_at,job.created_at for update skip locked
    limit least(greatest(coalesce(p_limit,2),1),4)
  ), claimed as (
    update public.book_enrichment_jobs job set status = 'processing', locked_at = now(),
      last_attempted_at = now(), attempt_count = job.attempt_count + 1, completed_at = null,
      last_error = null, updated_at = now()
    from candidates where job.id = candidates.id returning job.id,job.book_id,job.attempt_count
  ) select claimed.id,claimed.book_id,claimed.attempt_count from claimed;
$$;
revoke all on function public.claim_book_enrichment_jobs(integer,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_book_enrichment_jobs(integer,uuid,boolean) to service_role;

create or replace function public.select_due_goodreads_rating_books(p_limit integer default 8)
returns table(book_id uuid,mapping_known boolean,due_reason text)
language sql stable security invoker set search_path = '' as $$
  select h.book_id,h.goodreads_mapping_known,
    case when not h.goodreads_mapping_known then 'discovery_due'
      when coalesce(h.goodreads_failure_count,0) > 0 then 'retry_due'
      else 'stale_mapping' end
  from public.v_library_enrichment_health h
  join public.books b on b.id = h.book_id
  left join public.rating_refresh_state rs on rs.book_id = h.book_id and rs.provider = 'Goodreads'
  where h.goodreads_retry_due
  order by case when not h.goodreads_mapping_known or h.goodreads_fetched_at is null then 0
      when coalesce(h.goodreads_failure_count,0) > 0 then 1 else 2 end,
    rs.last_attempted_at asc nulls first, h.goodreads_fetched_at asc nulls first,b.created_at,h.book_id
  limit least(greatest(coalesce(p_limit,8),1),8);
$$;
revoke all on function public.select_due_goodreads_rating_books(integer) from public, anon, authenticated;
grant execute on function public.select_due_goodreads_rating_books(integer) to service_role;

create or replace function public.claim_goodreads_rating_refresh(p_book_id uuid,p_force boolean default false)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_due boolean;
begin
  if not exists(select 1 from public.library_entries where book_id = p_book_id) then return false; end if;
  insert into public.rating_refresh_state(book_id,provider) values(p_book_id,'Goodreads')
    on conflict(book_id,provider) do nothing;
  perform 1 from public.rating_refresh_state where book_id = p_book_id and provider = 'Goodreads' for update;
  select goodreads_retry_due into v_due from public.v_library_enrichment_health where book_id = p_book_id;
  if not p_force and not coalesce(v_due,false) then return false; end if;
  update public.rating_refresh_state set last_attempted_at = now(),next_retry_at = now() + interval '15 minutes'
    where book_id = p_book_id and provider = 'Goodreads';
  return true;
end;
$$;
revoke all on function public.claim_goodreads_rating_refresh(uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_goodreads_rating_refresh(uuid,boolean) to service_role;

create or replace function public.reconcile_library_enrichment()
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_book uuid; v_metadata integer := 0; v_goodreads integer := 0;
begin
  for v_book in select book_id from public.v_library_enrichment_health where not metadata_complete loop
    if private.enqueue_library_metadata(v_book) then v_metadata := v_metadata + 1; end if;
  end loop;
  -- Missing states are discovered by the scheduler even without this insert.
  -- Never reset failure backoff/leases, mappings, or successful TTL deadlines.
  insert into public.rating_refresh_state(book_id,provider,next_retry_at)
  select book_id,'Goodreads',now() from public.v_library_enrichment_health where goodreads_retry_due
  on conflict(book_id,provider) do nothing;
  get diagnostics v_goodreads = row_count;
  return jsonb_build_object('metadata_enqueued',v_metadata,'goodreads_states_created',v_goodreads);
end;
$$;
revoke all on function public.reconcile_library_enrichment() from public, anon, authenticated;
grant execute on function public.reconcile_library_enrichment(), private.enqueue_library_metadata(uuid) to service_role;

-- Idempotent, data-driven historical backfill; does not invoke providers.
select public.reconcile_library_enrichment();

-- Registered only when this migration is deployed. Existing worker schedules stay intact.
select cron.schedule('library-enrichment-reconciliation-twice-daily','7 0,12 * * *',
  $$select public.reconcile_library_enrichment();$$);

comment on view public.v_library_enrichment_health is
  'Service-only derived Library metadata and Goodreads completeness/due state; completed jobs describe metadata only.';
