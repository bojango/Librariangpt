-- Forward corrective migration for production, where the historical Goodreads
-- refresh migration was skipped. This is intentionally additive/idempotent.

create table if not exists public.rating_refresh_state (
  book_id uuid not null references public.books(id) on delete cascade,
  provider text not null check (length(btrim(provider)) between 1 and 80),
  last_attempted_at timestamptz,
  last_success_at timestamptz,
  next_retry_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_error text,
  last_http_status integer check (last_http_status is null or last_http_status between 100 and 599),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (book_id, provider)
);

create index if not exists rating_refresh_state_provider_retry_idx
  on public.rating_refresh_state(provider, next_retry_at, last_attempted_at);

drop trigger if exists rating_refresh_state_updated_at on public.rating_refresh_state;
create trigger rating_refresh_state_updated_at
before update on public.rating_refresh_state
for each row execute function private.set_updated_at();

alter table public.rating_refresh_state enable row level security;
revoke all on public.rating_refresh_state from public, anon, authenticated;
grant select on public.rating_refresh_state to authenticated;
grant select, insert, update, delete on public.rating_refresh_state to service_role;

drop policy if exists owner_select_rating_refresh_state on public.rating_refresh_state;
create policy owner_select_rating_refresh_state
on public.rating_refresh_state for select
to authenticated
using (private.is_owner());

create or replace function public.select_due_goodreads_rating_books(p_limit integer default 6)
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
  limit least(greatest(coalesce(p_limit, 6), 1), 8)
$$;

revoke all on function public.select_due_goodreads_rating_books(integer) from public, anon, authenticated;
grant execute on function public.select_due_goodreads_rating_books(integer) to service_role;

create or replace function public.claim_goodreads_rating_refresh(p_book_id uuid, p_force boolean default false)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rating_fetched_at timestamptz;
  v_next_retry_at timestamptz;
begin
  if not exists (select 1 from public.books b where b.id = p_book_id) then
    return false;
  end if;

  insert into public.rating_refresh_state(book_id, provider)
  values (p_book_id, 'Goodreads')
  on conflict (book_id, provider) do nothing;

  select rs.next_retry_at into v_next_retry_at
  from public.rating_refresh_state rs
  where rs.book_id = p_book_id and rs.provider = 'Goodreads'
  for update;

  select pr.fetched_at into v_rating_fetched_at
  from public.public_ratings pr
  where pr.book_id = p_book_id and lower(pr.provider) = 'goodreads'
  order by pr.fetched_at desc
  limit 1;

  if not p_force and (
    (v_rating_fetched_at is not null and v_rating_fetched_at >= now() - interval '7 days')
    or (v_next_retry_at is not null and v_next_retry_at > now())
  ) then
    return false;
  end if;

  update public.rating_refresh_state
  set last_attempted_at = now(), next_retry_at = now() + interval '15 minutes'
  where book_id = p_book_id and provider = 'Goodreads';

  return true;
end;
$$;

revoke all on function public.claim_goodreads_rating_refresh(uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_goodreads_rating_refresh(uuid, boolean) to service_role;

-- Keep every library surface Goodreads-only for its public rating. Diagnostic
-- provider rows remain stored in public_ratings and are not deleted.
create or replace view public.v_library with (security_invoker = true) as
select b.id,b.legacy_id,b.title,b.subtitle,
coalesce(string_agg(distinct a.name, ', ' order by a.name) filter(where a.name is not null),'') as authors,
max(s.name) as series,max(bs.series_order) as series_order,b.original_publication_year,b.fiction_nonfiction,b.primary_genre,b.themes_tags,b.language,b.synopsis,
l.overall_status,l.ownership_status,l.reading_priority,l.current_edition_id,b.reference_edition_id,e.id as display_edition_id,l.current_page,coalesce(l.total_pages,e.page_count) as total_pages,
case when l.current_page is not null and coalesce(l.total_pages,e.page_count) is not null and coalesce(l.total_pages,e.page_count)>0 then round(l.current_page::numeric/coalesce(l.total_pages,e.page_count)::numeric*100,1) else null end as progress_percent,
l.started_at,l.completed_at,l.user_rating_5,l.user_review,l.review_notes,l.reviewed_at,coalesce(e.cover_url,b.cover_url_preferred) as cover_url,e.cover_source,e.cover_verified,e.format as edition_format,e.binding,e.publisher,e.imprint,e.publication_year as edition_year,e.publication_date as edition_date,e.edition_statement,e.printing_impression,e.number_line,e.country,e.condition,e.isbn10,e.isbn13,e.page_count as edition_page_count,e.open_library_edition_id,e.open_library_work_id,e.google_books_volume_id,e.metadata_source as edition_metadata_source,e.metadata_last_fetched_at,e.metadata_match_confidence,e.signed,e.inscription,e.physical_dimensions,pr.provider as public_rating_provider,pr.rating_5 as public_rating_5,pr.rating_count as public_rating_count,pr.review_count as public_review_count,pr.source_url as public_rating_url,pr.fetched_at as public_rating_fetched_at,b.notes,
e.cover_locked,e.cover_uploaded_by_user,e.exact_copy_verified,e.exact_copy_verified_at,e.exact_copy_verification_source,e.identity_locked,e.page_count_verified,e.page_count_verification_source
from public.books b join public.library_entries l on l.book_id=b.id
left join public.book_authors ba on ba.book_id=b.id left join public.authors a on a.id=ba.author_id left join public.book_series bs on bs.book_id=b.id left join public.series s on s.id=bs.series_id left join public.editions e on e.id=coalesce(l.current_edition_id,b.reference_edition_id)
left join lateral (
  select x.* from public.public_ratings x
  where x.book_id=b.id and lower(x.provider)='goodreads'
  order by x.fetched_at desc limit 1
) pr on true
group by b.id,l.id,e.id,pr.id,pr.provider,pr.rating_5,pr.rating_count,pr.review_count,pr.source_url,pr.fetched_at;

grant select on public.v_library to authenticated, service_role;

comment on table public.rating_refresh_state is
  'Server-maintained Goodreads refresh attempts and retry backoff. Cached ratings remain in public_ratings.';
comment on function public.select_due_goodreads_rating_books(integer) is
  'Service-only stale-mapping-first Goodreads selector across every canonical book, capped at eight books.';

-- Supabase-native authenticated scheduler. The service key is read from Vault
-- at execution time; no credential is stored in this migration or cron command.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

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
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'goodreads_scheduler_service_key')
      ),
      body := '{"batch_size":6}'::jsonb,
      timeout_milliseconds := 90000
    );
  $schedule$
);
