-- Durable, source-agnostic metadata enrichment queue. Inserts only enqueue
-- database work; pg_cron invokes the existing book-background-enrich
-- orchestration outside the inserting transaction.

create table if not exists public.book_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','processing','retry','completed')),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_attempted_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  last_result jsonb not null default '{}'::jsonb,
  last_request_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_id)
);

create index if not exists book_enrichment_jobs_due_idx
  on public.book_enrichment_jobs (available_at, created_at)
  where status in ('queued','retry');

alter table public.book_enrichment_jobs enable row level security;
revoke all on table public.book_enrichment_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.book_enrichment_jobs to service_role;

drop trigger if exists book_enrichment_jobs_updated_at on public.book_enrichment_jobs;
create trigger book_enrichment_jobs_updated_at
before update on public.book_enrichment_jobs
for each row execute function private.set_updated_at();

create or replace function private.sync_book_enrichment_queue()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due timestamptz := greatest(coalesce(new.metadata_retry_after, now()), now());
begin
  if new.metadata_status in ('resolved','manual') then
    update public.book_enrichment_jobs
       set status = 'completed', completed_at = coalesce(completed_at, now()),
           locked_at = null, available_at = now(), last_error = null
     where book_id = new.id and status <> 'completed';
    return new;
  end if;

  -- A resolving update belongs to the worker that already holds the job.
  if tg_op = 'UPDATE' and new.metadata_status = 'resolving' then return new; end if;

  insert into public.book_enrichment_jobs (book_id, status, available_at, last_error)
  values (
    new.id,
    case when v_due > now() then 'retry' else 'queued' end,
    v_due,
    new.metadata_error
  )
  on conflict (book_id) do update set
    status = case
      when public.book_enrichment_jobs.status = 'processing'
        and public.book_enrichment_jobs.locked_at > now() - interval '15 minutes'
        then public.book_enrichment_jobs.status
      when excluded.available_at > now() then 'retry'
      else 'queued'
    end,
    available_at = case
      when public.book_enrichment_jobs.status = 'processing'
        and public.book_enrichment_jobs.locked_at > now() - interval '15 minutes'
        then public.book_enrichment_jobs.available_at
      else excluded.available_at
    end,
    completed_at = null,
    last_error = excluded.last_error,
    updated_at = now();
  return new;
end;
$$;

revoke all on function private.sync_book_enrichment_queue() from public, anon, authenticated;

drop trigger if exists books_enqueue_metadata_after_insert on public.books;
create trigger books_enqueue_metadata_after_insert
after insert on public.books
for each row execute function private.sync_book_enrichment_queue();

drop trigger if exists books_sync_metadata_retry_queue on public.books;
create trigger books_sync_metadata_retry_queue
after update of metadata_status, metadata_retry_after, metadata_error on public.books
for each row
when (
  old.metadata_status is distinct from new.metadata_status
  or old.metadata_retry_after is distinct from new.metadata_retry_after
  or old.metadata_error is distinct from new.metadata_error
)
execute function private.sync_book_enrichment_queue();

-- Database clients may create the canonical book before its library entry.
-- If a first worker attempt found no owner context, adding that entry should
-- make the existing retry immediately eligible instead of waiting out a
-- provider-independent backoff.
create or replace function private.wake_book_enrichment_queue_for_library_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.book_enrichment_jobs job
     set status = 'queued', available_at = now(), locked_at = null,
         completed_at = null, last_error = null, updated_at = now()
    from public.books book
   where job.book_id = new.book_id
     and book.id = new.book_id
     and book.metadata_status not in ('resolved','manual')
     and (
       job.status in ('queued','retry')
       or (job.status = 'processing' and job.locked_at < now() - interval '15 minutes')
     );
  return new;
end;
$$;

revoke all on function private.wake_book_enrichment_queue_for_library_entry() from public, anon, authenticated;

drop trigger if exists library_entries_wake_metadata_queue on public.library_entries;
create trigger library_entries_wake_metadata_queue
after insert on public.library_entries
for each row execute function private.wake_book_enrichment_queue_for_library_entry();

create or replace function public.claim_book_enrichment_jobs(
  p_limit integer default 2,
  p_book_id uuid default null,
  p_force boolean default false
)
returns table (job_id uuid, book_id uuid, attempt_count integer)
language sql
security definer
set search_path = ''
as $$
  with candidates as (
    select job.id
      from public.book_enrichment_jobs job
     where (p_book_id is null or job.book_id = p_book_id)
       and (
         (p_force and job.status <> 'processing')
         or (job.status in ('queued','retry') and job.available_at <= now())
         or (job.status = 'processing' and job.locked_at < now() - interval '15 minutes')
       )
     order by job.available_at, job.created_at
     for update skip locked
     limit least(greatest(coalesce(p_limit, 2), 1), 4)
  ), claimed as (
    update public.book_enrichment_jobs job
       set status = 'processing', locked_at = now(), last_attempted_at = now(),
           attempt_count = job.attempt_count + 1, completed_at = null,
           last_error = null, updated_at = now()
      from candidates
     where job.id = candidates.id
    returning job.id, job.book_id, job.attempt_count
  )
  select claimed.id, claimed.book_id, claimed.attempt_count from claimed;
$$;

revoke all on function public.claim_book_enrichment_jobs(integer, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_book_enrichment_jobs(integer, uuid, boolean) to service_role;

-- Recover historical partial/unresolved rows, including records created by
-- database clients that never opened Reading Room.
insert into public.book_enrichment_jobs (book_id, status, available_at, last_error)
select
  book.id,
  case when coalesce(book.metadata_retry_after, now()) > now() then 'retry' else 'queued' end,
  greatest(coalesce(book.metadata_retry_after, now()), now()),
  book.metadata_error
from public.books book
where book.metadata_status not in ('resolved','manual')
   or nullif(trim(book.synopsis), '') is null
   or (
     nullif(trim(book.cover_url_preferred), '') is null
     and not exists (
       select 1 from public.editions edition
        where edition.book_id = book.id and nullif(trim(edition.cover_url), '') is not null
     )
   )
on conflict (book_id) do nothing;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'book-metadata-enrichment-every-five-minutes';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end $$;

select cron.schedule(
  'book-metadata-enrichment-every-five-minutes',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/book-background-enrich',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_scheduler_service_key'),
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_scheduler_service_key'),
        'x-enrichment-scheduler-token', (select decrypted_secret from vault.decrypted_secrets where name = 'enrichment_scheduler_token')
      ),
      body := jsonb_build_object('batch_size', 2)
    ) as request_id;
  $$
);
