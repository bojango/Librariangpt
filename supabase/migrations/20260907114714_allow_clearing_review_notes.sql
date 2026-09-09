-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.save_book_review(p_book_id uuid, p_rating numeric, p_notes text default null, p_source text default 'frontend')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session uuid;
  v_feedback uuid;
  v_sentiment text;
  v_notes text := nullif(btrim(p_notes),'');
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_rating is not null and (p_rating < 0 or p_rating > 5) then raise exception 'Rating must be between 0 and 5'; end if;
  select id into v_session from public.reading_sessions where user_id=v_uid and book_id=p_book_id order by completed_at desc nulls last, started_at desc nulls last, created_at desc limit 1;
  update public.library_entries set user_rating_5=p_rating,user_review=v_notes,review_notes=v_notes,reviewed_at=now() where user_id=v_uid and book_id=p_book_id;
  if v_session is not null then update public.reading_sessions set user_rating_5=p_rating,review=v_notes,review_notes=v_notes where id=v_session; end if;
  v_sentiment := case when p_rating is null then 'Neutral' when p_rating >= 4 then 'Positive' when p_rating <= 2 then 'Negative' else 'Mixed' end;
  select id into v_feedback from public.reading_feedback where book_id=p_book_id and source_key='terminal_overall_review' limit 1;
  if v_feedback is null then
    insert into public.reading_feedback(user_id,feedback_date,book_id,session_id,reading_stage,sentiment,aspect,user_feedback,evidence_strength,confidence,generalisable,added_by,source_key)
    values(v_uid,current_date,p_book_id,v_session,'Post-read',v_sentiment,'Overall Review',coalesce(v_notes,'Rating: ' || to_char(p_rating,'FM0.00') || '/5'),'Moderate','Medium',false,p_source,'terminal_overall_review') returning id into v_feedback;
  else
    update public.reading_feedback set feedback_date=current_date,session_id=coalesce(v_session,session_id),sentiment=v_sentiment,user_feedback=coalesce(v_notes,'Rating: ' || to_char(p_rating,'FM0.00') || '/5'),added_by=p_source,updated_at=now() where id=v_feedback;
  end if;
  insert into public.library_events(user_id,book_id,session_id,event_type,source,payload) values(v_uid,p_book_id,v_session,'review_saved',p_source,jsonb_build_object('rating',p_rating,'has_notes',v_notes is not null));
  return jsonb_build_object('saved',true,'rating',p_rating,'feedback_id',v_feedback);
end;
$$;
