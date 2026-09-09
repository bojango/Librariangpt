-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

drop view if exists public.v_currently_reading;
drop view if exists public.v_owned_unread;
drop view if exists public.v_wishlist;
drop view if exists public.v_recently_read;
drop view if exists public.v_library;
drop view if exists public.v_reading_stats;

alter table public.library_entries drop constraint if exists library_entries_user_rating_5_check;
alter table public.library_entries alter column user_rating_5 type numeric(4,2) using user_rating_5::numeric(4,2);
alter table public.library_entries add constraint library_entries_user_rating_5_check check (user_rating_5 is null or (user_rating_5 >= 0 and user_rating_5 <= 5));
alter table public.library_entries add column if not exists review_notes text;
alter table public.library_entries add column if not exists reviewed_at timestamptz;

alter table public.reading_sessions drop constraint if exists reading_sessions_user_rating_5_check;
alter table public.reading_sessions alter column user_rating_5 type numeric(4,2) using user_rating_5::numeric(4,2);
alter table public.reading_sessions add constraint reading_sessions_user_rating_5_check check (user_rating_5 is null or (user_rating_5 >= 0 and user_rating_5 <= 5));
alter table public.reading_sessions add column if not exists review_notes text;

alter table public.reading_feedback add column if not exists source_key text;
create unique index if not exists reading_feedback_book_source_key_uq on public.reading_feedback(book_id, source_key) where source_key is not null;

create table if not exists public.public_ratings (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  provider text not null,
  rating_5 numeric(4,2) not null check (rating_5 >= 0 and rating_5 <= 5),
  rating_count bigint check (rating_count is null or rating_count >= 0),
  review_count bigint check (review_count is null or review_count >= 0),
  source_url text,
  provider_book_id text,
  is_primary boolean not null default false,
  fetched_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(book_id, provider)
);
create index if not exists public_ratings_book_idx on public.public_ratings(book_id);
drop trigger if exists public_ratings_updated_at on public.public_ratings;
create trigger public_ratings_updated_at before update on public.public_ratings for each row execute function private.set_updated_at();
alter table public.public_ratings enable row level security;
revoke all on public.public_ratings from anon;
grant select on public.public_ratings to authenticated;
drop policy if exists owner_select_public_ratings on public.public_ratings;
create policy owner_select_public_ratings on public.public_ratings for select to authenticated using (private.is_owner());

create or replace function public.save_book_review(p_book_id uuid, p_rating numeric, p_notes text default null, p_source text default 'frontend')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session uuid;
  v_feedback uuid;
  v_sentiment text;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_rating is not null and (p_rating < 0 or p_rating > 5) then raise exception 'Rating must be between 0 and 5'; end if;

  select id into v_session from public.reading_sessions
  where user_id=v_uid and book_id=p_book_id
  order by completed_at desc nulls last, started_at desc nulls last, created_at desc
  limit 1;

  update public.library_entries
  set user_rating_5=p_rating,
      user_review=coalesce(nullif(btrim(p_notes),''), user_review),
      review_notes=nullif(btrim(p_notes),''),
      reviewed_at=now()
  where user_id=v_uid and book_id=p_book_id;

  if v_session is not null then
    update public.reading_sessions
    set user_rating_5=p_rating,
        review=coalesce(nullif(btrim(p_notes),''), review),
        review_notes=nullif(btrim(p_notes),'')
    where id=v_session;
  end if;

  v_sentiment := case when p_rating is null then 'Neutral' when p_rating >= 4 then 'Positive' when p_rating <= 2 then 'Negative' else 'Mixed' end;

  select id into v_feedback from public.reading_feedback where book_id=p_book_id and source_key='terminal_overall_review' limit 1;
  if v_feedback is null then
    insert into public.reading_feedback(user_id, feedback_date, book_id, session_id, reading_stage, sentiment, aspect, user_feedback, evidence_strength, confidence, generalisable, added_by, source_key)
    values(v_uid, current_date, p_book_id, v_session, 'Post-read', v_sentiment, 'Overall Review', coalesce(nullif(btrim(p_notes),''), 'Rating: ' || to_char(p_rating,'FM0.00') || '/5'), 'Moderate', 'Medium', false, p_source, 'terminal_overall_review')
    returning id into v_feedback;
  else
    update public.reading_feedback
    set feedback_date=current_date,
        session_id=coalesce(v_session,session_id),
        sentiment=v_sentiment,
        user_feedback=coalesce(nullif(btrim(p_notes),''), 'Rating: ' || to_char(p_rating,'FM0.00') || '/5'),
        added_by=p_source,
        updated_at=now()
    where id=v_feedback;
  end if;

  insert into public.library_events(user_id,book_id,session_id,event_type,source,payload)
  values(v_uid,p_book_id,v_session,'review_saved',p_source,jsonb_build_object('rating',p_rating,'has_notes',nullif(btrim(p_notes),'') is not null));

  return jsonb_build_object('saved',true,'rating',p_rating,'feedback_id',v_feedback);
end;
$$;
revoke all on function public.save_book_review(uuid,numeric,text,text) from public, anon;
grant execute on function public.save_book_review(uuid,numeric,text,text) to authenticated;

create view public.v_library with (security_invoker = true) as
select
  b.id, b.legacy_id, b.title, b.subtitle,
  coalesce(string_agg(distinct a.name, ', ' order by a.name) filter (where a.name is not null),'') as authors,
  max(s.name) as series,
  max(bs.series_order) as series_order,
  b.original_publication_year, b.fiction_nonfiction, b.primary_genre, b.themes_tags, b.language, b.synopsis,
  l.overall_status, l.ownership_status, l.reading_priority, l.current_edition_id, b.reference_edition_id, e.id as display_edition_id,
  l.current_page, coalesce(l.total_pages,e.page_count) as total_pages,
  case when l.current_page is not null and coalesce(l.total_pages,e.page_count) is not null and coalesce(l.total_pages,e.page_count)>0 then round((l.current_page::numeric/coalesce(l.total_pages,e.page_count)::numeric)*100,1) end as progress_percent,
  l.started_at, l.completed_at, l.user_rating_5, l.user_review, l.review_notes, l.reviewed_at,
  coalesce(e.cover_url,b.cover_url_preferred) as cover_url, e.cover_source, e.cover_verified,
  e.format as edition_format, e.binding, e.publisher, e.imprint, e.publication_year as edition_year, e.publication_date as edition_date,
  e.edition_statement, e.printing_impression, e.number_line, e.country, e.condition,
  e.isbn10, e.isbn13, e.page_count as edition_page_count,
  e.open_library_edition_id, e.open_library_work_id, e.google_books_volume_id,
  e.metadata_source as edition_metadata_source, e.metadata_last_fetched_at, e.metadata_match_confidence,
  e.signed, e.inscription, e.physical_dimensions,
  pr.provider as public_rating_provider, pr.rating_5 as public_rating_5, pr.rating_count as public_rating_count,
  pr.review_count as public_review_count, pr.source_url as public_rating_url, pr.fetched_at as public_rating_fetched_at,
  b.notes
from public.books b
join public.library_entries l on l.book_id=b.id
left join public.book_authors ba on ba.book_id=b.id
left join public.authors a on a.id=ba.author_id
left join public.book_series bs on bs.book_id=b.id
left join public.series s on s.id=bs.series_id
left join public.editions e on e.id=coalesce(l.current_edition_id,b.reference_edition_id)
left join lateral (
  select x.* from public.public_ratings x
  where x.book_id=b.id
  order by x.is_primary desc, case lower(x.provider) when 'goodreads' then 1 when 'google books' then 2 when 'open library' then 3 else 9 end, x.fetched_at desc
  limit 1
) pr on true
group by b.id,l.id,e.id,pr.id,pr.provider,pr.rating_5,pr.rating_count,pr.review_count,pr.source_url,pr.fetched_at;

create view public.v_currently_reading with (security_invoker = true) as select * from public.v_library where overall_status='Currently Reading';
create view public.v_owned_unread with (security_invoker = true) as select * from public.v_library where overall_status='Owned - Unread';
create view public.v_wishlist with (security_invoker = true) as select * from public.v_library where overall_status='Wishlist';
create view public.v_recently_read with (security_invoker = true) as select * from public.v_library where overall_status='Read' order by completed_at desc nulls last;
create view public.v_reading_stats with (security_invoker = true) as
select
  count(*) filter (where overall_status='Read') as total_books_read,
  count(*) filter (where overall_status='Read' and completed_at >= date_trunc('year',now())) as books_read_this_year,
  count(*) filter (where overall_status='Currently Reading') as currently_reading,
  count(*) filter (where overall_status='Owned - Unread') as owned_unread,
  count(*) filter (where overall_status='Wishlist') as wishlist,
  round(avg(user_rating_5) filter (where user_rating_5 is not null),2) as average_rating
from public.library_entries;

