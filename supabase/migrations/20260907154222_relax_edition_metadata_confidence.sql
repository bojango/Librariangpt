-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

alter table public.editions drop constraint if exists editions_metadata_match_confidence_check;
