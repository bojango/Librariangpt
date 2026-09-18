-- Structured, source-backed book recognition. Catalogue records are reusable;
-- book_accolades contains the claim and its provenance.
create table public.accolades (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  type text not null default 'Recognition' check (type in ('Award','Prize','Bestseller','Recognition')),
  logo_url text,
  logo_alt text,
  official_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accolades_name_key unique (name)
);

create table public.book_accolades (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete cascade,
  accolade_id uuid not null references public.accolades(id) on delete restrict,
  year integer check (year between 0 and 3000),
  category text,
  result text not null default 'Recognition' check (result in ('Winner','Bestseller','Finalist','Shortlisted','Longlisted','Nominee','Recognition')),
  source_url text not null check (source_url ~* '^https?://'),
  source_name text,
  verified boolean not null default false,
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint book_accolades_unique_claim unique nulls not distinct (book_id, accolade_id, year, result, category)
);

create index book_accolades_book_display_idx
  on public.book_accolades (book_id, verified desc, sort_order asc nulls last, year desc nulls last);

create trigger accolades_updated_at before update on public.accolades
  for each row execute function private.set_updated_at();
create trigger book_accolades_updated_at before update on public.book_accolades
  for each row execute function private.set_updated_at();

alter table public.accolades enable row level security;
alter table public.book_accolades enable row level security;

grant select, insert, update, delete on public.accolades, public.book_accolades to authenticated;

create policy owner_all_accolades on public.accolades for all to authenticated
  using (private.is_owner()) with check (private.is_owner());
create policy owner_all_book_accolades on public.book_accolades for all to authenticated
  using (private.is_owner()) with check (private.is_owner());
