-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.set_book_page_count(p_book_id uuid,p_total_pages integer,p_source text default 'frontend') returns jsonb
language plpgsql set search_path=''
as $$
declare
 v_uid uuid := (select auth.uid());
 v_edition uuid;
 v_current_page integer;
 v_status text;
 v_old_total integer;
begin
 if not private.is_owner() then raise exception 'Not authorized'; end if;
 if p_total_pages is null or p_total_pages<1 then raise exception 'Total pages must be positive'; end if;
 select current_edition_id,current_page,overall_status,total_pages into v_edition,v_current_page,v_status,v_old_total
 from public.library_entries where user_id=v_uid and book_id=p_book_id;
 if not found then raise exception 'Book not found in library'; end if;
 if v_current_page is not null and v_current_page>p_total_pages and v_status<>'Read' then raise exception 'Total pages cannot be below current page'; end if;

 update public.library_entries
 set total_pages=p_total_pages,
     current_page=case when overall_status='Read' and coalesce(current_page,0)>p_total_pages then p_total_pages else current_page end,
     updated_at=now()
 where user_id=v_uid and book_id=p_book_id;

 update public.reading_sessions
 set total_pages=p_total_pages,
     current_page=case when status='Completed' and coalesce(current_page,0)>p_total_pages then p_total_pages else current_page end,
     updated_at=now()
 where user_id=v_uid and book_id=p_book_id
   and (status in ('Reading','Paused') or (v_status='Read' and status='Completed'));

 update public.progress_logs pl
 set total_pages_snapshot=p_total_pages,
     page=case when page>p_total_pages then p_total_pages else page end
 where pl.user_id=v_uid and pl.book_id=p_book_id
   and (v_old_total is null or pl.total_pages_snapshot=v_old_total or pl.total_pages_snapshot is null);

 if v_edition is not null then
   update public.editions set page_count=p_total_pages,page_count_verified=true,page_count_verification_source=p_source,identity_locked=true,updated_at=now() where id=v_edition;
 end if;

 insert into public.library_events(user_id,book_id,event_type,source,payload)
 values(v_uid,p_book_id,'page_count_corrected',p_source,jsonb_build_object('old_total_pages',v_old_total,'total_pages',p_total_pages,'verified',true,'completed_book_adjusted',v_status='Read'));
 return jsonb_build_object('saved',true,'old_total_pages',v_old_total,'total_pages',p_total_pages,'page_count_verified',true,'completed_book_adjusted',v_status='Read');
end;$$;
