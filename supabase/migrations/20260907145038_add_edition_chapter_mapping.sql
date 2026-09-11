-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create table if not exists public.edition_chapters (
  id bigint generated always as identity primary key,
  edition_id uuid not null references public.editions(id) on delete cascade,
  sequence_no integer not null check (sequence_no > 0),
  level smallint not null default 1 check (level >= 0),
  entry_type text not null default 'chapter' check (entry_type in ('chapter','part','introduction','prologue','epilogue','appendix','other')),
  chapter_number text,
  chapter_title text not null,
  start_page integer not null check (start_page >= 0),
  end_page integer check (end_page is null or end_page >= start_page),
  source text not null default 'manual',
  source_url text,
  verified boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, sequence_no)
);

create index if not exists edition_chapters_page_idx on public.edition_chapters(edition_id,start_page desc,level desc,sequence_no desc);

alter table public.editions add column if not exists chapter_map_source text;
alter table public.editions add column if not exists chapter_map_status text check (chapter_map_status is null or chapter_map_status in ('available','partial','manual','not_found'));
alter table public.editions add column if not exists chapter_map_last_checked_at timestamptz;

alter table public.edition_chapters enable row level security;
grant select,insert,update,delete on public.edition_chapters to authenticated;
grant usage,select on sequence public.edition_chapters_id_seq to authenticated;

drop policy if exists owner_edition_chapters on public.edition_chapters;
create policy owner_edition_chapters on public.edition_chapters for all to authenticated
using (private.is_owner()) with check (private.is_owner());

create trigger edition_chapters_updated_at before update on public.edition_chapters
for each row execute function private.set_updated_at();

create or replace view public.v_library_chapters with (security_invoker = true) as
select v.*,
       ch.id as current_chapter_id,
       ch.sequence_no as current_chapter_sequence,
       ch.chapter_number as current_chapter_number,
       ch.chapter_title as current_chapter_title,
       ch.entry_type as current_chapter_type,
       ch.start_page as current_chapter_start_page,
       ch.end_page as current_chapter_end_page,
       e.chapter_map_source,
       e.chapter_map_status,
       e.chapter_map_last_checked_at
from public.v_library v
left join public.editions e on e.id = v.display_edition_id
left join lateral (
  select c.*
  from public.edition_chapters c
  where c.edition_id = v.display_edition_id
    and v.current_page is not null
    and c.start_page <= v.current_page
    and (c.end_page is null or c.end_page >= v.current_page)
  order by c.start_page desc, c.level desc, c.sequence_no desc
  limit 1
) ch on true;

grant select on public.v_library_chapters to authenticated;

