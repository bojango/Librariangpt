-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create index if not exists book_cover_candidates_edition_idx on public.book_cover_candidates(edition_id);
