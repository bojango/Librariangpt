-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

alter table public.books add column if not exists cover_locked boolean not null default false;
alter table public.editions add column if not exists cover_locked boolean not null default false;

create table if not exists public.book_cover_candidates (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  edition_id uuid references public.editions(id) on delete cascade,
  provider text not null,
  source_label text,
  source_url text not null,
  exact_edition boolean not null default false,
  selected boolean not null default false,
  width integer,
  height integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(book_id, source_url)
);

create index if not exists book_cover_candidates_book_idx on public.book_cover_candidates(book_id, exact_edition desc, created_at desc);

alter table public.book_cover_candidates enable row level security;
grant select,insert,update,delete on public.book_cover_candidates to authenticated;
create policy owner_cover_candidates on public.book_cover_candidates for all to authenticated using (private.is_owner()) with check (private.is_owner());

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('book-covers','book-covers',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

update public.recommendations
set why_recommended = case
  when recommendation_strength='Wildcard' then
    rtrim(why_recommended) || ' It is intentionally a wildcard rather than a safe genre match: the useful test is whether ' || coalesce(array_to_string(key_themes, ', '),'these particular elements') || ' are strong enough to carry the book for you even if other parts fall outside your established preferences.'
  when recommendation_strength in ('Strong','Must Read') then
    rtrim(why_recommended) || ' The recommendation is driven by the combination of ' || coalesce(array_to_string(key_themes, ', '),'these underlying features') || ', which overlaps strongly with patterns already emerging in your reading feedback. The main value is the specific mix of those elements, not simply that it sits in a familiar genre.'
  else
    rtrim(why_recommended) || ' The recommendation is based mainly on its combination of ' || coalesce(array_to_string(key_themes, ', '),'these underlying features') || ', rather than genre alone. It looks compatible with what has worked so far while still giving us useful new evidence about how important those elements are to you.'
end,
updated_at=now()
where why_recommended is not null and length(btrim(why_recommended)) < 140;

