-- Additive foundation only. Catalogue seed is separately reviewed; no historical
-- migrations, canonical metadata, library entries or recommendations are changed.
create table public.collection_catalogue_books (
  key text primary key check (length(key) between 1 and 180),
  book_id uuid unique references public.books(id) on delete set null,
  title text not null,
  authors text not null,
  publication_year integer check (publication_year between 1 and 2200),
  publication_state text not null default 'published' check (publication_state in ('published','forthcoming')),
  format text,
  cover_url text,
  source_url text not null check (source_url like 'https://%'),
  verified_at date not null
);
create table public.collections (
  key text primary key check (length(key) between 1 and 180),
  series_id uuid unique references public.series(id) on delete restrict,
  name text not null,
  kind text not null check (kind in ('series','universe','crossover')),
  description text not null,
  complete boolean not null default false,
  source_url text not null check (source_url like 'https://%'),
  check (series_id is null or kind='series')
);
create table public.collection_memberships (
  collection_key text not null references public.collections(key) on delete cascade,
  work_key text not null references public.collection_catalogue_books(key) on delete cascade,
  official_number numeric(8,2) check (official_number > 0),
  primary key(collection_key,work_key)
);
create index collection_memberships_work_idx on public.collection_memberships(work_key);
create index collection_memberships_order_idx on public.collection_memberships(collection_key,official_number);
create index if not exists book_series_collection_idx on public.book_series(series_id,series_order);
create table public.reading_paths (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  collection_key text not null references public.collections(key) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,collection_key),
  unique(id,user_id)
);
create index reading_paths_collection_idx on public.reading_paths(collection_key);
create table public.reading_path_entries (
  path_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  work_key text not null references public.collection_catalogue_books(key) on delete restrict,
  position integer not null check (position > 0),
  selection text not null check (selection in ('recommended','optional','skipped')),
  reasoning text check (length(reasoning) <= 10000),
  primary key(path_id,work_key),
  foreign key(path_id,user_id) references public.reading_paths(id,user_id) on delete cascade,
  unique(path_id,position)
);
create index reading_path_entries_user_idx on public.reading_path_entries(user_id,path_id);
create index reading_path_entries_work_idx on public.reading_path_entries(work_key);

alter table public.collections enable row level security;
alter table public.collection_catalogue_books enable row level security;
alter table public.collection_memberships enable row level security;
alter table public.reading_paths enable row level security;
alter table public.reading_path_entries enable row level security;
create policy owner_catalogue_read on public.collection_catalogue_books for select to authenticated using (private.is_owner());
create policy owner_collections_read on public.collections for select to authenticated using (private.is_owner());
create policy owner_memberships_read on public.collection_memberships for select to authenticated using (private.is_owner());
create policy owner_reading_paths on public.reading_paths for all to authenticated
  using (private.is_owner() and user_id=(select auth.uid()))
  with check (private.is_owner() and user_id=(select auth.uid()));
create policy owner_reading_path_entries on public.reading_path_entries for all to authenticated
  using (private.is_owner() and user_id=(select auth.uid()))
  with check (private.is_owner() and user_id=(select auth.uid()));
revoke all on public.collections,public.collection_catalogue_books,public.collection_memberships,public.reading_paths,public.reading_path_entries from public,anon,authenticated,service_role;
grant select on public.collections,public.collection_catalogue_books,public.collection_memberships to authenticated;
grant select,insert,update,delete on public.reading_paths,public.reading_path_entries to authenticated;
grant select,insert,update,delete on public.collections,public.collection_catalogue_books,public.collection_memberships,public.reading_paths,public.reading_path_entries to service_role;

-- Invoker privileges and RLS apply throughout. Atomic replacement means an
-- invalid row cannot delete a previously saved path. Lock serialises tab saves.
create function public.save_reading_path(p_collection_key text,p_entries jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_user uuid := auth.uid(); v_path uuid;
begin
  if v_user is null or not private.is_owner() then
    raise exception 'Not authorized' using errcode='42501';
  end if;
  if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)>500 then
    raise exception 'Expected at most 500 path entries' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_array_elements(p_entries) e where
    jsonb_typeof(e) is distinct from 'object' or nullif(e->>'work_key','') is null
    or coalesce(e->>'selection','') not in ('recommended','optional','skipped')) then
    raise exception 'Invalid path entry' using errcode='22023';
  end if;
  insert into public.reading_paths(user_id,collection_key) values(v_user,p_collection_key)
    on conflict(user_id,collection_key) do update set updated_at=now() returning id into v_path;
  perform 1 from public.reading_paths where id=v_path for update;
  delete from public.reading_path_entries where path_id=v_path and user_id=v_user;
  insert into public.reading_path_entries(path_id,user_id,work_key,position,selection,reasoning)
    select v_path,v_user,e->>'work_key',n::integer,e->>'selection',nullif(e->>'reasoning','')
    from jsonb_array_elements(p_entries) with ordinality as rows(e,n);
  return v_path;
end;
$$;
revoke all on function public.save_reading_path(text,jsonb) from public,anon;
grant execute on function public.save_reading_path(text,jsonb) to authenticated;
