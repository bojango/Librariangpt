-- Read-only production definition captured 2026-10-09; isolated tests only.
create or replace function public.record_reading_checkin_bridge(
  p_book_id uuid,
  p_session_id uuid,
  p_checkin_kind text,
  p_current_page integer default null,
  p_total_pages integer default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_owner_id uuid;
  v_event_id bigint;
  v_progress numeric;
begin
  select s.owner_user_id into v_owner_id
  from private.app_state s
  where s.singleton = true;

  if v_owner_id is null then
    raise exception 'Reading bridge owner is not configured';
  end if;

  if p_checkin_kind is null or btrim(p_checkin_kind) = '' then
    raise exception 'checkin kind is required';
  end if;

  if not exists (
    select 1 from public.library_entries le
    where le.user_id = v_owner_id and le.book_id = p_book_id
  ) then
    raise exception 'Book does not belong to configured reading owner';
  end if;

  if p_session_id is not null and not exists (
    select 1 from public.reading_sessions rs
    where rs.id = p_session_id and rs.user_id = v_owner_id and rs.book_id = p_book_id
  ) then
    raise exception 'Session does not belong to configured reading owner/book';
  end if;

  if p_checkin_kind = 'final_review' and exists (
    select 1 from public.library_events e
    where e.user_id = v_owner_id
      and e.book_id = p_book_id
      and (p_session_id is null or e.session_id = p_session_id or e.session_id is null)
      and e.event_type = 'reading_checkin'
      and e.payload->>'checkin_kind' = 'final_review'
  ) then
    return jsonb_build_object('saved', false, 'reason', 'duplicate_final_review_prompt');
  end if;

  if p_checkin_kind <> 'final_review' and p_current_page is not null and exists (
    select 1 from public.library_events e
    where e.user_id = v_owner_id
      and e.book_id = p_book_id
      and (p_session_id is null or e.session_id = p_session_id or e.session_id is null)
      and e.event_type = 'reading_checkin'
      and e.payload->>'checkin_kind' = p_checkin_kind
      and (e.payload->>'current_page') ~ '^[0-9]+$'
      and (e.payload->>'current_page')::integer = p_current_page
  ) then
    return jsonb_build_object('saved', false, 'reason', 'duplicate_page_checkin');
  end if;

  if p_current_page is not null and p_total_pages is not null and p_total_pages > 0 then
    v_progress := round(100.0 * p_current_page::numeric / p_total_pages::numeric, 1);
  end if;

  insert into public.library_events(user_id, book_id, session_id, event_type, source, payload)
  values (
    v_owner_id,
    p_book_id,
    p_session_id,
    'reading_checkin',
    'chatgpt',
    jsonb_strip_nulls(jsonb_build_object(
      'checkin_kind', p_checkin_kind,
      'current_page', p_current_page,
      'total_pages', p_total_pages,
      'current_percentage', v_progress,
      'reason', p_reason
    ))
  )
  returning id into v_event_id;

  return jsonb_build_object('saved', true, 'event_id', v_event_id);
end;
$function$;
