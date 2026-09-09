-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.set_book_page_count(p_book_id uuid, p_total_pages integer, p_source text default 'frontend')
returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_edition uuid;
  v_current_page integer;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_total_pages is null or p_total_pages < 1 then raise exception 'Total pages must be positive'; end if;

  select current_edition_id,current_page into v_edition,v_current_page
  from public.library_entries where user_id=v_uid and book_id=p_book_id;
  if not found then raise exception 'Book not found in library'; end if;
  if v_current_page is not null and v_current_page > p_total_pages then raise exception 'Total pages cannot be below current page'; end if;

  update public.library_entries set total_pages=p_total_pages,updated_at=now() where user_id=v_uid and book_id=p_book_id;
  update public.reading_sessions set total_pages=p_total_pages where user_id=v_uid and book_id=p_book_id and status in ('Reading','Paused');
  if v_edition is not null then update public.editions set page_count=p_total_pages,updated_at=now() where id=v_edition; end if;

  insert into public.library_events(user_id,book_id,event_type,source,payload)
  values(v_uid,p_book_id,'page_count_corrected',p_source,jsonb_build_object('total_pages',p_total_pages));
  return jsonb_build_object('saved',true,'total_pages',p_total_pages);
end;
$function$;
grant execute on function public.set_book_page_count(uuid,integer,text) to authenticated;
