-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.is_library_owner()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.is_owner();
$$;
revoke all on function public.is_library_owner() from public, anon;
grant execute on function public.is_library_owner() to authenticated;

