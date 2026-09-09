-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

alter table public.books add column if not exists metadata_status text not null default 'unresolved' check (metadata_status in ('unresolved','resolving','partial','resolved','ambiguous','failed','manual'));
alter table public.books add column if not exists metadata_confidence numeric(4,3) check (metadata_confidence is null or (metadata_confidence >= 0 and metadata_confidence <= 1));
alter table public.books add column if not exists metadata_last_attempted_at timestamptz;
alter table public.books add column if not exists metadata_retry_after timestamptz;
alter table public.books add column if not exists metadata_error text;
alter table public.books add column if not exists metadata_resolved_at timestamptz;

create table if not exists public.book_metadata_candidates (
  id bigint generated always as identity primary key,
  book_id uuid not null references public.books(id) on delete cascade,
  provider text not null,
  provider_item_id text,
  candidate_title text not null,
  candidate_authors text[] not null default '{}',
  isbn10 text,
  isbn13 text,
  publication_year integer,
  language text,
  page_count integer,
  cover_url text,
  score numeric(5,4) not null check (score >= 0 and score <= 1),
  selected boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(book_id, provider, provider_item_id)
);
create index if not exists book_metadata_candidates_book_score_idx on public.book_metadata_candidates(book_id, score desc);
alter table public.book_metadata_candidates enable row level security;
drop policy if exists owner_book_metadata_candidates on public.book_metadata_candidates;
create policy owner_book_metadata_candidates on public.book_metadata_candidates for all to authenticated using (private.is_owner()) with check (private.is_owner());
grant select,insert,update,delete on public.book_metadata_candidates to authenticated;
grant usage,select on sequence public.book_metadata_candidates_id_seq to authenticated;

update public.books b set metadata_status = case
  when exists (select 1 from public.editions e where e.book_id=b.id and (e.isbn10 is not null or e.isbn13 is not null)) and b.synopsis is not null then 'resolved'
  when exists (select 1 from public.editions e where e.book_id=b.id and (e.isbn10 is not null or e.isbn13 is not null)) or b.synopsis is not null then 'partial'
  else 'unresolved' end,
  metadata_confidence = case
    when exists (select 1 from public.editions e where e.book_id=b.id and (e.isbn10 is not null or e.isbn13 is not null)) then 0.95
    when b.synopsis is not null then 0.70
    else null end
where b.metadata_status='unresolved';
