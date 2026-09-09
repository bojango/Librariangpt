-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.delete_library_book(p_book_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_title text;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;

  select title into v_title from public.books where id = p_book_id;
  if v_title is null then raise exception 'Book not found'; end if;

  if not exists (
    select 1 from public.library_entries
    where book_id = p_book_id and user_id = v_uid
  ) then
    raise exception 'Book is not in your library';
  end if;

  insert into public.library_events(user_id, book_id, event_type, source, payload)
  values(v_uid, p_book_id, 'book_deleted', 'frontend', jsonb_build_object('title', v_title));

  delete from public.books where id = p_book_id;
  return true;
end;
$function$;

grant execute on function public.delete_library_book(uuid) to authenticated;
