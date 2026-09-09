-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

alter table public.editions
  add column if not exists open_library_edition_id text,
  add column if not exists open_library_work_id text,
  add column if not exists google_books_volume_id text,
  add column if not exists metadata_source text,
  add column if not exists metadata_last_fetched_at timestamptz,
  add column if not exists metadata_match_confidence text,
  add column if not exists metadata_payload jsonb not null default '{}'::jsonb,
  add column if not exists is_reference boolean not null default false,
  add column if not exists physical_dimensions text;

alter table public.books
  add column if not exists reference_edition_id uuid references public.editions(id) on delete set null;

create unique index if not exists editions_open_library_edition_uidx
  on public.editions(open_library_edition_id) where open_library_edition_id is not null;
create unique index if not exists editions_google_books_volume_uidx
  on public.editions(google_books_volume_id) where google_books_volume_id is not null;
create index if not exists books_reference_edition_idx on public.books(reference_edition_id);

alter table public.editions drop constraint if exists editions_metadata_match_confidence_check;
alter table public.editions add constraint editions_metadata_match_confidence_check
  check (metadata_match_confidence is null or metadata_match_confidence in ('Exact ISBN','Strong','Medium','Weak','Manual'));

create or replace function private.clean_isbn(p_isbn text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_isbn,''), '[^0-9Xx]', '', 'g'));
$$;

create or replace function private.is_valid_isbn(p_isbn text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := private.clean_isbn(p_isbn);
  s integer := 0;
  i integer;
  d integer;
begin
  if length(v) = 10 then
    for i in 1..10 loop
      if i = 10 and substr(v,i,1) = 'X' then d := 10;
      elsif substr(v,i,1) ~ '^[0-9]$' then d := substr(v,i,1)::integer;
      else return false;
      end if;
      s := s + d * (11-i);
    end loop;
    return mod(s,11)=0;
  elsif length(v) = 13 and v ~ '^[0-9]{13}$' then
    s := 0;
    for i in 1..12 loop
      d := substr(v,i,1)::integer;
      s := s + d * case when mod(i,2)=1 then 1 else 3 end;
    end loop;
    return mod(10 - mod(s,10),10) = substr(v,13,1)::integer;
  end if;
  return false;
end;
$$;

-- Rebuild library views so unowned books can display a reference edition while owned books display the selected copy.
drop view if exists public.v_currently_reading;
drop view if exists public.v_owned_unread;
drop view if exists public.v_wishlist;
drop view if exists public.v_recently_read;
drop view if exists public.v_library;

create view public.v_library with (security_invoker = true) as
select
  b.id, b.legacy_id, b.title, b.subtitle,
  coalesce(string_agg(distinct a.name, ', ' order by a.name) filter (where a.name is not null),'') as authors,
  max(s.name) as series,
  max(bs.series_order) as series_order,
  b.original_publication_year, b.fiction_nonfiction, b.primary_genre, b.themes_tags, b.language, b.synopsis,
  l.overall_status, l.ownership_status, l.reading_priority,
  l.current_edition_id,
  b.reference_edition_id,
  e.id as display_edition_id,
  l.current_page,
  coalesce(l.total_pages,e.page_count) as total_pages,
  case when l.current_page is not null and coalesce(l.total_pages,e.page_count) is not null and coalesce(l.total_pages,e.page_count) > 0
       then round((l.current_page::numeric/coalesce(l.total_pages,e.page_count)::numeric)*100,1) end as progress_percent,
  l.started_at, l.completed_at, l.user_rating_5, l.user_review,
  coalesce(e.cover_url,b.cover_url_preferred) as cover_url,
  e.format as edition_format,
  e.binding,
  e.publisher,
  e.imprint,
  e.publication_year as edition_year,
  e.publication_date as edition_date,
  e.isbn10,
  e.isbn13,
  e.page_count as edition_page_count,
  e.open_library_edition_id,
  e.open_library_work_id,
  e.google_books_volume_id,
  e.metadata_source as edition_metadata_source,
  e.metadata_last_fetched_at,
  e.metadata_match_confidence,
  e.signed,
  e.inscription,
  e.physical_dimensions,
  b.notes
from public.books b
join public.library_entries l on l.book_id=b.id
left join public.book_authors ba on ba.book_id=b.id
left join public.authors a on a.id=ba.author_id
left join public.book_series bs on bs.book_id=b.id
left join public.series s on s.id=bs.series_id
left join public.editions e on e.id=coalesce(l.current_edition_id,b.reference_edition_id)
group by b.id,l.id,e.id;

create view public.v_currently_reading with (security_invoker = true) as
  select * from public.v_library where overall_status='Currently Reading';
create view public.v_owned_unread with (security_invoker = true) as
  select * from public.v_library where overall_status='Owned - Unread';
create view public.v_wishlist with (security_invoker = true) as
  select * from public.v_library where overall_status='Wishlist';
create view public.v_recently_read with (security_invoker = true) as
  select * from public.v_library where overall_status='Read' order by completed_at desc nulls last;

grant select on public.v_library, public.v_currently_reading, public.v_owned_unread, public.v_wishlist, public.v_recently_read to authenticated;

