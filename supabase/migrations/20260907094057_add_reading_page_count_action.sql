-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.set_reading_page_count(p_book_id uuid, p_total_pages integer, p_source text default 'frontend')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session uuid;
  v_edition uuid;
  v_page integer;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_total_pages is null or p_total_pages < 1 then raise exception 'Total pages must be positive'; end if;

  select id,current_page,edition_id into v_session,v_page,v_edition
  from public.reading_sessions
  where user_id=v_uid and book_id=p_book_id and status in ('Reading','Paused')
  order by started_at desc nulls last,created_at desc limit 1;

  if v_session is null then raise exception 'No active or paused reading session'; end if;
  if v_page is not null and v_page > p_total_pages then raise exception 'Total pages cannot be below current page'; end if;

  update public.reading_sessions set total_pages=p_total_pages where id=v_session;
  update public.library_entries set total_pages=p_total_pages where book_id=p_book_id;
  if v_edition is not null then
    update public.editions set page_count=p_total_pages where id=v_edition and (page_count is null or page_count <> p_total_pages);
  end if;

  insert into public.library_events(user_id,book_id,session_id,event_type,source,payload)
  values(v_uid,p_book_id,v_session,'page_count_set',p_source,jsonb_build_object('total_pages',p_total_pages));

  return jsonb_build_object('total_pages',p_total_pages,'session_id',v_session);
end;
$$;

revoke execute on function public.set_reading_page_count(uuid,integer,text) from public,anon;
grant execute on function public.set_reading_page_count(uuid,integer,text) to authenticated;
