-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create table if not exists public.book_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  book_id uuid not null references public.books(id) on delete cascade,
  edition_id uuid references public.editions(id) on delete set null,
  session_id uuid references public.reading_sessions(id) on delete set null,
  page_start integer,
  page_end integer,
  chapter text,
  quote_text text not null,
  note text,
  tags text[] not null default '{}',
  capture_method text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint book_quotes_page_start_check check (page_start is null or page_start > 0),
  constraint book_quotes_page_end_check check (page_end is null or page_end > 0),
  constraint book_quotes_page_order_check check (page_end is null or page_start is null or page_end >= page_start),
  constraint book_quotes_capture_method_check check (capture_method in ('scan','manual','paste')),
  constraint book_quotes_text_check check (length(btrim(quote_text)) > 0)
);

create index if not exists book_quotes_book_page_idx on public.book_quotes(user_id, book_id, page_start, created_at);
create index if not exists book_quotes_session_idx on public.book_quotes(session_id) where session_id is not null;

alter table public.book_quotes enable row level security;

drop policy if exists owner_book_quotes on public.book_quotes;
create policy owner_book_quotes on public.book_quotes
for all to authenticated
using (private.is_owner() and user_id = (select auth.uid()))
with check (private.is_owner() and user_id = (select auth.uid()));

grant select, insert, update, delete on public.book_quotes to authenticated;

create trigger book_quotes_set_updated_at
before update on public.book_quotes
for each row execute function private.set_updated_at();
