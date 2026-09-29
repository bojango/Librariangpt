-- Atomic prompt claim: only the caller that inserted the acknowledgement may ask.
-- Older parallel sessions must not advertise an already-passed transition as actionable.
create or replace function private.next_read_snapshot(u uuid) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object(
 'version','context-v1','generated_at',now(),'visible_count',5,'target_count',8,'planning_threshold_percent',75,
 'active_intent',(select to_jsonb(i) - 'request_payload' from public.next_read_intents i where user_id=u and state='active'),
 'transitions',coalesce((select jsonb_agg(to_jsonb(t) order by t.started_at desc) from (
   select rs.id session_id,rs.book_id,b.title,rs.status,rs.started_at,
     coalesce(rs.current_page,le.current_page) current_page,coalesce(rs.total_pages,le.total_pages,e.page_count) total_pages,
     round(100.0*coalesce(rs.current_page,le.current_page,0)/nullif(coalesce(rs.total_pages,le.total_pages,e.page_count),0),1) progress_percent,
     tr.status planning_status,tr.acknowledged_at,
     (tr.session_id is null and rs.status='Reading' and
       100.0*coalesce(rs.current_page,le.current_page,0)/nullif(coalesce(rs.total_pages,le.total_pages,e.page_count),0)>=75
       and not exists(select 1 from public.next_read_intents i where i.user_id=u and i.source_session_id=rs.id)
       and not exists(select 1 from public.reading_sessions newer where newer.user_id=u and newer.id<>rs.id
         and newer.book_id<>rs.book_id and newer.started_at>coalesce(rs.completed_at,rs.started_at)
         and newer.status in ('Reading','Completed'))) should_capture_intent
   from public.reading_sessions rs join public.books b on b.id=rs.book_id
   join public.library_entries le on le.user_id=u and le.book_id=rs.book_id
   left join public.editions e on e.id=coalesce(rs.edition_id,le.current_edition_id,b.reference_edition_id)
   left join public.next_read_transitions tr on tr.user_id=u and tr.session_id=rs.id
   where rs.user_id=u and (rs.status in ('Reading','Paused') or rs.completed_at>=now()-interval '30 days')
 ) t),'[]'),
 'queue',private.planner_queue(u),'candidates',private.next_read_candidates(u),
 'planner_state',(select to_jsonb(s) from public.up_next_planner_state s where user_id=u),
 'taste_profile',coalesce((select jsonb_agg(to_jsonb(t)) from public.taste_profile t where user_id=u),'[]'),
 'recent_feedback',coalesce((select jsonb_agg(to_jsonb(f)) from (select * from public.reading_feedback where user_id=u order by created_at desc limit 20) f),'[]'),
 'recent_reading',coalesce((select jsonb_agg(to_jsonb(r)) from (select rs.book_id,b.title,b.primary_genre,rs.status,rs.total_pages,rs.user_rating_5,rs.started_at,rs.completed_at
   from public.reading_sessions rs join public.books b on b.id=rs.book_id where rs.user_id=u order by coalesce(rs.completed_at,rs.started_at,rs.created_at) desc limit 5) r),'[]')
);
$$;

create or replace function private.next_read_dispatch(action text, session uuid default null, payload jsonb default '{}', request_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; sid uuid; bid uuid; iid uuid; previous public.next_read_intents%rowtype; result jsonb; k text;
begin
  u:=private.planner_owner();
  if action='snapshot' then return private.next_read_snapshot(u); end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('next-read:'||u::text,0));
  if action='refresh' then
    return private.refresh_next_read(u,left(coalesce(payload->>'reason','explicit_refresh'),200),coalesce((payload->>'force')::boolean,true));
  elsif action='expire' then
    if nullif(btrim(payload->>'reason'),'') is null then raise exception 'Expiry reason required'; end if;
    update public.next_read_intents set state='expired',expiry_reason=left(payload->>'reason',200),expired_at=now(),updated_at=now() where user_id=u and state='active';
    return private.refresh_next_read(u,'intent_expired');
  elsif action in ('save','acknowledge') then
    -- Retry lookup comes before session validation: a completed transition cannot resurrect old intent.
    if action='save' then
      if request_key is null or length(request_key) not between 1 and 200 then raise exception 'A stable request key is required'; end if;
      select * into previous from public.next_read_intents i where i.user_id=u and i.request_key=next_read_dispatch.request_key;
      if found then
        if previous.source_session_id is distinct from session or previous.request_payload is distinct from payload then
          raise exception 'Request key already used with different intent';
        end if;
        return jsonb_build_object('intent_id',previous.id,'state',previous.state,'duplicate',true);
      end if;
    end if;
    if session is not null then
      select rs.id,rs.book_id into sid,bid from public.reading_sessions rs
        where rs.user_id=u and rs.id=session and rs.status in ('Reading','Paused','Completed','DNF');
      if sid is null then raise exception 'Reading transition not found'; end if;
      if exists(select 1 from public.reading_sessions newer join public.reading_sessions source on source.id=sid
        where newer.user_id=u and newer.id<>sid and newer.started_at>coalesce(source.completed_at,source.started_at)
          and newer.book_id<>source.book_id and newer.status in ('Reading','Completed')) then
        raise exception 'Reading transition has passed';
      end if;
    elsif action='acknowledge' then raise exception 'Session required'; end if;
    if action='acknowledge' then
      if coalesce(payload->>'status','') not in ('asked','skipped') then raise exception 'Invalid acknowledgement'; end if;
      insert into public.next_read_transitions(user_id,session_id,status) values(u,sid,payload->>'status')
        on conflict(user_id,session_id) do nothing returning session_id into sid;
      return jsonb_build_object('acknowledged',sid is not null,'session_id',session);
    end if;
    if jsonb_typeof(payload) is distinct from 'object' then raise exception 'Intent must be an object'; end if;
    for k in select jsonb_object_keys(payload) loop
      if not(k=any(array['fiction_nonfiction','preferred_genres','avoided_genres','preferred_max_pages','prefer_shorter','change_of_pace',
          'desired_styles','avoided_styles','desired_book_ids','deferred_book_ids','context','confidence','source'])) then raise exception 'Unknown intent field: %',k; end if;
    end loop;
    foreach k in array array['preferred_genres','avoided_genres','desired_styles','avoided_styles','desired_book_ids','deferred_book_ids'] loop
      if payload ? k and (jsonb_typeof(payload->k)<>'array' or jsonb_array_length(payload->k)>50) then raise exception 'Invalid intent array: %',k; end if;
      if exists(select 1 from jsonb_array_elements(coalesce(payload->k,'[]')) x where jsonb_typeof(x)<>'string' or length(x #>> '{}')>200) then raise exception 'Invalid intent label: %',k; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements_text(coalesce(payload->'desired_book_ids','[]') || coalesce(payload->'deferred_book_ids','[]')) x
      where not exists(select 1 from public.library_entries le where le.user_id=u and le.book_id=x::uuid)) then raise exception 'Intent books must belong to your library'; end if;
    update public.next_read_intents set state='expired',expiry_reason='replaced_by_new_intent',expired_at=now(),updated_at=now() where user_id=u and state='active';
    insert into public.next_read_intents(user_id,source_session_id,source_book_id,fiction_nonfiction,preferred_genres,avoided_genres,
      preferred_max_pages,prefer_shorter,change_of_pace,desired_styles,avoided_styles,desired_book_ids,deferred_book_ids,context,confidence,source,request_key,request_payload)
    values(u,sid,bid,payload->>'fiction_nonfiction',
      array(select jsonb_array_elements_text(coalesce(payload->'preferred_genres','[]'))),array(select jsonb_array_elements_text(coalesce(payload->'avoided_genres','[]'))),
      (payload->>'preferred_max_pages')::integer,coalesce((payload->>'prefer_shorter')::boolean,false),coalesce((payload->>'change_of_pace')::boolean,false),
      array(select jsonb_array_elements_text(coalesce(payload->'desired_styles','[]'))),array(select jsonb_array_elements_text(coalesce(payload->'avoided_styles','[]'))),
      array(select x::uuid from jsonb_array_elements_text(coalesce(payload->'desired_book_ids','[]')) x),array(select x::uuid from jsonb_array_elements_text(coalesce(payload->'deferred_book_ids','[]')) x),
      payload->>'context',coalesce(payload->>'confidence','Medium'),coalesce(payload->>'source','user'),request_key,payload) returning id into iid;
    if sid is not null then
      insert into public.next_read_transitions(user_id,session_id,status) values(u,sid,'captured')
        on conflict(user_id,session_id) do update set status='captured',acknowledged_at=now();
    end if;
    result:=private.refresh_next_read(u,'intent_saved');
    return result || jsonb_build_object('intent_id',iid,'state','active','duplicate',false);
  end if;
  raise exception 'Invalid planner action';
end $$;
