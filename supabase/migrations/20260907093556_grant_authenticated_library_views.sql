-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

revoke all on public.v_library, public.v_currently_reading, public.v_owned_unread, public.v_wishlist, public.v_recently_read from public, anon;
grant select on public.v_library, public.v_currently_reading, public.v_owned_unread, public.v_wishlist, public.v_recently_read to authenticated;
