-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.finish_reading(p_book_id uuid, p_rating numeric default null, p_review text default null, p_source text default 'frontend')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session uuid;
  v_total integer;
  v_feedback uuid;
  v_sentiment text;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_rating is not null and (p_rating < 0 or p_rating > 5) then raise exception 'Rating must be between 0 and 5'; end if;
  select id,total_pages into v_session,v_total from public.reading_sessions where user_id=v_uid and book_id=p_book_id and status in ('Reading','Paused') order by started_at desc nulls last,created_at desc limit 1;
  if v_session is null then raise exception 'No active reading session'; end if;

  update public.reading_sessions set
    status='Completed', completed_at=now(), current_page=coalesce(total_pages,current_page), last_progress_at=now(),
    user_rating_5=coalesce(p_rating,user_rating_5), review=coalesce(nullif(btrim(p_review),''),review), review_notes=coalesce(nullif(btrim(p_review),''),review_notes)
  where id=v_session;

  update public.library_entries set
    overall_status='Read', completed_at=now(), current_page=coalesce(total_pages,current_page),
    user_rating_5=coalesce(p_rating,user_rating_5), user_review=coalesce(nullif(btrim(p_review),''),user_review),
    review_notes=coalesce(nullif(btrim(p_review),''),review_notes), reviewed_at=case when p_rating is not null or nullif(btrim(p_review),'') is not null then now() else reviewed_at end
  where book_id=p_book_id;

  if p_rating is not null or nullif(btrim(p_review),'') is not null then
    v_sentiment := case when p_rating is null then 'Neutral' when p_rating >= 4 then 'Positive' when p_rating <= 2 then 'Negative' else 'Mixed' end;
    select id into v_feedback from public.reading_feedback where book_id=p_book_id and source_key='terminal_overall_review' limit 1;
    if v_feedback is null then
      insert into public.reading_feedback(user_id,feedback_date,book_id,session_id,reading_stage,sentiment,aspect,user_feedback,evidence_strength,confidence,generalisable,added_by,source_key)
      values(v_uid,current_date,p_book_id,v_session,'Post-read',v_sentiment,'Overall Review',coalesce(nullif(btrim(p_review),''),'Rating: ' || to_char(p_rating,'FM0.00') || '/5'),'Moderate','Medium',false,p_source,'terminal_overall_review')
      returning id into v_feedback;
    else
      update public.reading_feedback set feedback_date=current_date,session_id=v_session,sentiment=v_sentiment,user_feedback=coalesce(nullif(btrim(p_review),''),'Rating: ' || to_char(p_rating,'FM0.00') || '/5'),added_by=p_source,updated_at=now() where id=v_feedback;
    end if;
  end if;

  if v_total is not null then
    insert into public.progress_logs(user_id,session_id,book_id,page,total_pages_snapshot,source)
    values(v_uid,v_session,p_book_id,v_total,v_total,case when p_source in ('frontend','chatgpt','migration','manual','import') then p_source else 'frontend' end);
  end if;
  insert into public.library_events(user_id,book_id,session_id,event_type,source,payload) values(v_uid,p_book_id,v_session,'reading_finished',p_source,jsonb_build_object('rating',p_rating,'has_review_notes',nullif(btrim(p_review),'') is not null));
  return jsonb_build_object('completed',true,'session_id',v_session,'feedback_id',v_feedback);
end;
$$;
