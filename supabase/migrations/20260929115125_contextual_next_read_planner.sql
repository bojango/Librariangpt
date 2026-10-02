-- Contextual planning is separate from compatibility/discovery and never writes taste evidence.
-- Reconciled against fbbpovieqfsjunmqtxvf on 2026-09-29; see docs/next-read-planner.md.
create table public.next_read_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_session_id uuid references public.reading_sessions(id) on delete set null,
  source_book_id uuid references public.books(id) on delete set null,
  fiction_nonfiction text check (fiction_nonfiction in ('Fiction','Nonfiction')),
  preferred_genres text[] not null default '{}',
  avoided_genres text[] not null default '{}',
  preferred_max_pages integer check (preferred_max_pages between 1 and 10000),
  prefer_shorter boolean not null default false,
  change_of_pace boolean not null default false,
  desired_styles text[] not null default '{}',
  avoided_styles text[] not null default '{}',
  desired_book_ids uuid[] not null default '{}',
  deferred_book_ids uuid[] not null default '{}',
  context text check (length(context) <= 4000),
  confidence text not null default 'Medium' check (confidence in ('Low','Medium','High')),
  source text not null default 'user' check (source in ('user','reading_checkin')),
  request_key text not null check (length(request_key) between 1 and 200),
  request_payload jsonb not null,
  state text not null default 'active' check (state in ('active','expired')),
  expiry_reason text,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,request_key),
  check ((state='active' and expired_at is null and expiry_reason is null)
      or (state='expired' and expired_at is not null and expiry_reason is not null))
);
create unique index next_read_one_active on public.next_read_intents(user_id) where state='active';
create index next_read_intent_session on public.next_read_intents(source_session_id);
create index next_read_intent_book on public.next_read_intents(source_book_id);

-- A session is the transition identity. Acknowledgement survives replacement/expiry of intent.
create table public.next_read_transitions (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.reading_sessions(id) on delete cascade,
  status text not null check (status in ('asked','captured','skipped')),
  acknowledged_at timestamptz not null default now(),
  primary key(user_id,session_id)
);
create index next_read_transition_session on public.next_read_transitions(session_id);

create table public.up_next_planner_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dirty boolean not null default true,
  reasons text[] not null default '{}',
  changed_at timestamptz not null default now(),
  refreshed_at timestamptz
);
create table public.up_next_refreshes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null,
  algorithm_version text not null default 'context-v1',
  before_queue jsonb not null,
  after_queue jsonb not null,
  candidates jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index up_next_refresh_user_time on public.up_next_refreshes(user_id,created_at desc);
create table public.up_next_exclusions (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  reason text not null default 'Manually removed; re-add to reconsider.',
  created_at timestamptz not null default now(),
  primary key(user_id,book_id)
);
create index up_next_exclusion_book on public.up_next_exclusions(book_id);

alter table public.library_entries add column expected_available_on date;
comment on column public.library_entries.expected_available_on is
  'Explicit expected arrival/availability date; ownership_status remains the canonical On Order state.';
alter table public.up_next_queue add column ranking_details jsonb not null default '{}';
alter table public.up_next_queue add constraint up_next_unique_position unique(user_id,position) deferrable initially deferred;

do $$ declare t text; begin
  foreach t in array array['next_read_intents','next_read_transitions','up_next_planner_state','up_next_refreshes','up_next_exclusions'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy owner_read on public.%I for select to authenticated using (private.is_owner() and user_id=(select auth.uid()))',t);
  end loop;
end $$;

-- Only the narrow dispatcher is callable by API roles. All other helpers are internal.
create function private.planner_owner() returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid; begin
  if private.is_owner() then return (select auth.uid()); end if;
  if (select auth.jwt()->>'role') = 'service_role' then
    select owner_user_id into u from private.app_state where singleton;
    if u is not null then return u; end if;
  end if;
  raise exception 'Not authorized' using errcode='42501';
end $$;

create function private.mark_up_next_dirty(u uuid, reason text) returns void
language sql set search_path='' as $$
  insert into public.up_next_planner_state(user_id,dirty,reasons)
  values(u,true,array[reason]) on conflict(user_id) do update
  set dirty=true, changed_at=now(), reasons=(select array_agg(distinct r)
    from unnest(public.up_next_planner_state.reasons || excluded.reasons) r);
$$;

-- Exact, case-insensitive metadata labels only. Never interpret preference prose by keyword.
create function private.planner_labels(labels text[]) returns text[]
language sql immutable set search_path='' as $$
  select coalesce(array_agg(distinct lower(btrim(x))) filter(where btrim(x)<>''),'{}')
  from (
    select unnest(labels) x
    union select unnest(regexp_split_to_array(x,' / ')) from unnest(labels) x
    union select 'science fiction' from unnest(labels) x
      where lower(x) like '%science fiction%' or lower(x) in ('sf','sci-fi')
  ) expanded;
$$;

create function private.next_read_candidates(u uuid) returns jsonb
language sql stable set search_path='' as $$
with intent as (
  select * from public.next_read_intents where user_id=u and state='active'
), recent as (
  select b.primary_genre, rs.total_pages, rs.current_page, rs.id, rs.started_at, rs.last_progress_at
  from public.reading_sessions rs join public.books b on b.id=rs.book_id
  where rs.user_id=u and rs.status in ('Reading','Completed','DNF','Paused')
  order by (rs.id=(select source_session_id from intent)) desc nulls last,
    coalesce(rs.completed_at,rs.started_at,rs.created_at) desc,rs.id limit 3
), progress as (
  -- Conservative estimate from at least two recent progress samples in the source session.
  select case when max(pl.page)>min(pl.page) and max(pl.logged_at)>min(pl.logged_at)
    then current_date + ceil(greatest(0,max(r.total_pages)-max(pl.page)) /
      ((max(pl.page)-min(pl.page)) / greatest(1,extract(epoch from max(pl.logged_at)-min(pl.logged_at))/86400)))::integer
    end as estimated_finish_on
  from recent r join public.progress_logs pl on pl.session_id=r.id and pl.user_id=u
  where r.id=(select id from recent limit 1) and pl.logged_at>=now()-interval '21 days'
), base as (
  select le.book_id,b.title,b.fiction_nonfiction,b.primary_genre,
    private.planner_labels(b.themes_tags || array[b.primary_genre,b.fiction_nonfiction]) labels,
    coalesce(le.total_pages,ed.page_count) pages,le.ownership_status,le.expected_available_on,
    le.reading_priority,q.source,q.locked,q.position old_position,
    r.match_score_10,r.match_confidence,r.recommendation_strength,r.user_interest,
    (select max(ev.occurred_at) from public.library_events ev where ev.user_id=u and ev.book_id=le.book_id
      and (ev.event_type in ('book_received','book_acquired','purchase_received') or
        (ev.event_type='ownership_changed' and ev.payload->>'ownership_status'='Owned'
          and coalesce(ev.payload->>'previous_ownership_status','')<>'Owned'))) acquired_at,
    (select max(ev.occurred_at) from public.library_events ev where ev.user_id=u and ev.book_id=le.book_id and ev.event_type='purchase_ordered') ordered_at
  from public.library_entries le join public.books b on b.id=le.book_id
  left join public.editions ed on ed.id=coalesce(le.current_edition_id,b.reference_edition_id)
  left join public.up_next_queue q on q.user_id=u and q.book_id=le.book_id
  left join lateral (select rec.* from public.recommendations rec where rec.user_id=u and rec.book_id=le.book_id
    order by rec.date_recommended desc nulls last,rec.created_at desc,rec.id limit 1) r on true
  where le.user_id=u and le.overall_status in ('Owned - Unread','Wishlist','Recommended','Paused')
    and not exists(select 1 from public.reading_sessions rs where rs.user_id=u and rs.book_id=le.book_id and rs.status='Reading')
    and coalesce(r.user_interest,'') not in ('Not Interested','Dismissed')
    and coalesce(r.recommendation_status,'') not in ('Not Interested','Dismissed','Rejected')
    and not exists(select 1 from public.up_next_exclusions x where x.user_id=u and x.book_id=le.book_id)
), signals as (
  select base.*, i.id intent_id,
    coalesce(book_id=any(i.deferred_book_ids),false) deferred,
    coalesce(book_id=any(i.desired_book_ids),false) desired,
    -- Conflicts form a rule tier. Purchase and recommendation scores cannot erase them.
    (case when i.fiction_nonfiction is not null and base.fiction_nonfiction is not null and i.fiction_nonfiction<>base.fiction_nonfiction then 1 else 0 end
      + case when labels && private.planner_labels(i.avoided_genres || i.avoided_styles) then 1 else 0 end
      + case when pages>i.preferred_max_pages then 1 else 0 end
      + case when i.prefer_shorter and pages>=(select total_pages from recent limit 1) then 1 else 0 end) conflicts,
    (case when i.fiction_nonfiction=base.fiction_nonfiction then 1 else 0 end
      + case when labels && private.planner_labels(i.preferred_genres) then 1 else 0 end
      + case when labels && private.planner_labels(i.desired_styles) then 1 else 0 end
      + case when pages<=i.preferred_max_pages then 1 else 0 end
      + case when i.prefer_shorter and pages<(select total_pages from recent limit 1) then 1 else 0 end) appetite_matches,
    coalesce(base.source='Manual' or reading_priority='High' or user_interest in ('Very High','High','Want to Read','Read Soon'),false) soon,
    coalesce((select sum(case tp.direction when 'Positive' then 1 when 'Negative' then -1 else 0 end)
      from public.taste_profile tp where tp.user_id=u and tp.confidence in ('High','Medium')
      and labels && private.planner_labels(regexp_split_to_array(tp.dimension,' / '))),0) taste_signal,
    coalesce((select sum(case rf.sentiment when 'Positive' then 1 when 'Negative' then -1 else 0 end)
      from public.reading_feedback rf where rf.user_id=u and rf.generalisable=true and rf.evidence_strength='Strong'
      and labels && private.planner_labels(regexp_split_to_array(rf.aspect,' / '))),0) feedback_signal,
    case when primary_genre is not null and exists(select 1 from recent)
      and not exists(select 1 from recent where private.planner_labels(array[recent.primary_genre]) && private.planner_labels(array[base.primary_genre]))
      then case when i.change_of_pace then 2 else 1 end else 0 end contrast,
    case when ownership_status in ('Owned','Borrowed') then 2
      when ownership_status='On Order' and expected_available_on<=(select estimated_finish_on from progress) then 1 else 0 end availability,
    case when ownership_status='Owned' then greatest(0,1-extract(epoch from now()-acquired_at)/3888000.0) else 0 end acquisition_signal
  from base left join intent i on true
), ranked as (
 select signals.*,
   case when deferred then 3 when conflicts>0 then 2 when appetite_matches>0 then 0 else 1 end appetite_tier,
   greatest(0,least(5,floor(coalesce(match_score_10,5)/2)+greatest(-1,least(1,taste_signal+feedback_signal)))) compatibility_band,
   case when ownership_status='On Order' then 1 else 0 end order_signal,
   case when recommendation_strength='Wildcard' then 1 else 0 end wildcard,
   concat_ws(' ',
     case when deferred then 'Kept for a later read; you have deferred it for this transition.'
       when conflicts>0 then 'A future candidate, but less suited to your current appetite.'
       when appetite_matches>0 then 'Fits what you feel like reading next.' else 'A candidate from your library.' end,
     case when desired then 'You still want to read this soon.' when soon then 'Reflects your own reading priority.' end,
     case when pages is not null then pages::text || ' pages.' else 'Length is not yet known.' end,
     case when contrast>0 then 'Offers a change from your recent reading.' end,
     case when ownership_status='On Order' then case when availability=1 then 'On order, expected before your estimated finish.' else 'On order; availability for your next read is not confirmed.' end
       when ownership_status in ('Owned','Borrowed') then 'Available to read.' else 'You would need to obtain a copy.' end,
     case when acquisition_signal>0 then 'Recently acquired, as a small supporting signal.' end,
     case when recommendation_strength='Wildcard' then 'An opportunity to explore something different.' end) reason
 from signals
)
select coalesce(jsonb_agg(to_jsonb(ranked) order by appetite_tier,appetite_matches desc,
  (desired or soon) desc,compatibility_band desc,contrast desc,availability desc,
  order_signal desc,acquisition_signal desc nulls last,match_score_10 desc nulls last,
  wildcard desc,old_position nulls last,book_id),'[]') from ranked;
$$;

create function private.planner_queue(u uuid) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(q) order by q.position,q.added_at,q.id),'[]')
 from public.up_next_queue q where user_id=u;
$$;

create function private.refresh_next_read(u uuid, why text, force_refresh boolean default true) returns jsonb
language plpgsql set search_path='' as $$
declare candidates jsonb; before_q jsonb; after_q jsonb; c jsonb; chosen uuid[]:='{}';
  bid uuid; pos integer; target integer; result_id uuid; available_exists boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('next-read:'||u::text,0));
  if not force_refresh and exists(select 1 from public.up_next_planner_state where user_id=u and not dirty
    and refreshed_at>now()-interval '1 day') then
    return jsonb_build_object('refreshed',false,'queue_count',jsonb_array_length(private.planner_queue(u)));
  end if;
  before_q:=private.planner_queue(u);
  candidates:=private.next_read_candidates(u);
  -- Read/DNF/dismissed/removed entries cannot be rescued by a lock.
  delete from public.up_next_queue q where q.user_id=u
    and not exists(select 1 from jsonb_array_elements(candidates) x where (x->>'book_id')::uuid=q.book_id);
  select coalesce(array_agg(book_id),'{}') into chosen from public.up_next_queue where user_id=u and locked;
  target:=greatest(8,cardinality(chosen));
  available_exists:=exists(select 1 from jsonb_array_elements(candidates) x where (x->>'availability')::integer=2 and not (x->>'deferred')::boolean);
  for pos in 1..greatest(target,coalesce((select max(position) from public.up_next_queue where user_id=u and locked),0)) loop
    if exists(select 1 from public.up_next_queue where user_id=u and locked and position=pos) then continue; end if;
    exit when cardinality(chosen)>=target;
    select x into c from jsonb_array_elements(candidates) with ordinality a(x,ord)
      where not ((x->>'book_id')::uuid=any(chosen))
        -- An unavailable book never takes the first automatic slot ahead of an available option.
        and (pos<>1 or not available_exists or (x->>'availability')::integer=2)
      order by ord limit 1;
    if c is null then continue; end if;
    bid:=(c->>'book_id')::uuid;
    chosen:=array_append(chosen,bid);
    insert into public.up_next_queue(user_id,book_id,position,source,reason,ai_score,confidence,ranking_details)
    values(u,bid,pos,'AI',c->>'reason',null,c->>'match_confidence',c)
    on conflict(user_id,book_id) do update set position=excluded.position,
      reason=excluded.reason,ranking_details=excluded.ranking_details,
      ai_score=null,confidence=excluded.confidence;
  end loop;
  delete from public.up_next_queue where user_id=u and not(book_id=any(chosen));
  -- Keep manual explanations and positions; attach fresh context to the inspectable evidence.
  update public.up_next_queue q set ranking_details=x || jsonb_build_object('position_rule','locked')
    from jsonb_array_elements(candidates) x where q.user_id=u and q.locked and q.book_id=(x->>'book_id')::uuid;
  after_q:=private.planner_queue(u);
  insert into public.up_next_refreshes(user_id,reason,before_queue,after_queue,candidates)
    values(u,why,before_q,after_q,candidates) returning id into result_id;
  insert into public.up_next_planner_state(user_id,dirty,reasons,refreshed_at)
    values(u,false,'{}',now()) on conflict(user_id) do update set dirty=false,reasons='{}',refreshed_at=now();
  return jsonb_build_object('refreshed',true,'refresh_id',result_id,'queue_count',jsonb_array_length(after_q));
end $$;

create function private.next_read_snapshot(u uuid) returns jsonb
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
       and not exists(select 1 from public.next_read_intents i where i.user_id=u and i.source_session_id=rs.id)) should_capture_intent
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

create function private.next_read_dispatch(action text, session uuid default null, payload jsonb default '{}', request_key text default null)
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
        on conflict(user_id,session_id) do nothing;
      return jsonb_build_object('acknowledged',true,'session_id',sid);
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

create function public.next_read_planning_snapshot() returns jsonb language sql security invoker set search_path='' as $$
 select private.next_read_dispatch('snapshot'); $$;
create function public.save_next_read_intent(p_session_id uuid,p_intent jsonb,p_request_key text) returns jsonb language sql security invoker set search_path='' as $$
 select private.next_read_dispatch('save',p_session_id,p_intent,p_request_key); $$;
create function public.refresh_up_next(p_reason text default 'explicit_refresh',p_force boolean default true) returns jsonb language sql security invoker set search_path='' as $$
 select private.next_read_dispatch('refresh',null,jsonb_build_object('reason',p_reason,'force',p_force)); $$;
create function public.acknowledge_next_read_transition(p_session_id uuid,p_status text default 'asked') returns jsonb language sql security invoker set search_path='' as $$
 select private.next_read_dispatch('acknowledge',p_session_id,jsonb_build_object('status',p_status)); $$;
create function public.expire_next_read_intent(p_reason text) returns jsonb language sql security invoker set search_path='' as $$
 select private.next_read_dispatch('expire',null,jsonb_build_object('reason',p_reason)); $$;

-- One ownership field, one explicit write path, durable purchase/receipt events.
create function private.planner_set_availability(book uuid, ownership text, arrival date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; old_status text; begin
 u:=private.planner_owner();
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('next-read:'||u::text,0));
 select ownership_status into old_status from public.library_entries where user_id=u and book_id=book for update;
 if not found then raise exception 'Book not in library'; end if;
 if ownership is null or ownership not in ('Not Owned','Owned','On Order','Borrowed','Unknown') then raise exception 'Invalid ownership'; end if;
 update public.library_entries set ownership_status=ownership,expected_available_on=case when ownership='On Order' then arrival end,
   overall_status=case when ownership='Owned' and overall_status in ('Wishlist','Recommended') then 'Owned - Unread' else overall_status end
 where user_id=u and book_id=book;
 perform private.mark_up_next_dirty(u,'availability_changed');
 return jsonb_build_object('book_id',book,'ownership_status',ownership);
end $$;
create function public.set_book_availability(p_book_id uuid,p_ownership_status text,p_expected_available_on date default null)
returns jsonb language sql security invoker set search_path='' as $$
 select private.planner_set_availability(p_book_id,p_ownership_status,p_expected_available_on); $$;

-- Triggers only invalidate on meaningful fields. The app/automation coalesces changes into a refresh.
create function private.next_read_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare u uuid; reason text; j jsonb; oldj jsonb; begin
 j:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 u:=(j->>'user_id')::uuid;
 if u is null then return null; end if;
 if tg_op='UPDATE' then
   oldj:=to_jsonb(old)-array['updated_at','last_updated','last_evaluated_at'];
   if oldj=(j-array['updated_at','last_updated','last_evaluated_at']) then return null; end if;
 end if;
 reason:=tg_table_name||'_changed';
 if tg_table_name='library_entries' then
   if tg_op='UPDATE' and (to_jsonb(old)->'overall_status',to_jsonb(old)->'ownership_status',to_jsonb(old)->'reading_priority',to_jsonb(old)->'expected_available_on',to_jsonb(old)->'total_pages')
     is not distinct from (j->'overall_status',j->'ownership_status',j->'reading_priority',j->'expected_available_on',j->'total_pages') then return null; end if;
   if tg_op='UPDATE' and old.ownership_status is distinct from new.ownership_status then
     insert into public.library_events(user_id,book_id,event_type,source,payload) values(u,new.book_id,
       case when new.ownership_status='On Order' then 'purchase_ordered' else 'ownership_changed' end,
       'next_read_planner',jsonb_build_object('ownership_status',new.ownership_status,
         'previous_ownership_status',old.ownership_status,'expected_available_on',new.expected_available_on));
   end if;
 elsif tg_table_name='reading_sessions' then
   if tg_op='UPDATE' and old.status is not distinct from new.status then return null; end if;
   if tg_op<>'DELETE' and j->>'status'='Reading' and (tg_op='INSERT' or to_jsonb(old)->>'status'='Planned') then
     update public.next_read_intents set state='expired',expired_at=now(),updated_at=now(),expiry_reason='next_book_started'
       where user_id=u and state='active' and source_book_id is distinct from new.book_id;
   end if;
 elsif tg_table_name='library_events' then
   if j->>'event_type' not in ('purchase_ordered','ownership_changed','book_received','book_acquired','purchase_received','library_status_changed','availability_changed') then return null; end if;
 elsif tg_table_name='reading_feedback' then
   if tg_op<>'DELETE' and coalesce(j->>'evidence_strength','') not in ('Strong','Moderate') then return null; end if;
 elsif tg_table_name='recommendations' then
   if tg_op='INSERT' and coalesce((j->>'match_score_10')::numeric,0)<8.5 and coalesce(j->>'user_interest','') not in ('High','Read Soon','Want to Read') then return null; end if;
 end if;
 perform private.mark_up_next_dirty(u,reason);
 return null;
end $$;

do $$ declare t text; begin
 foreach t in array array['library_entries','reading_sessions','library_events','reading_feedback','taste_profile','recommendations'] loop
   execute format('create trigger next_read_changed after insert or update or delete on public.%I for each row execute function private.next_read_changed()',t);
 end loop;
end $$;

-- Replaces both the deployed remove-only function and the undeployed reserve variant.
create or replace function private.remove_started_book_from_up_next() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.user_id is not null and old.overall_status is distinct from new.overall_status then
   if new.overall_status='Currently Reading' and old.overall_status<>'Paused' then
     update public.next_read_intents set state='expired',expired_at=now(),updated_at=now(),expiry_reason='next_book_started'
       where user_id=new.user_id and state='active' and source_book_id is distinct from new.book_id;
   end if;
   perform private.refresh_next_read(new.user_id,'reading_status_changed');
 end if;
 return new;
end $$;

-- Preserve signature if older environments have the reserve migration installed.
create or replace function private.replenish_up_next(p_user_id uuid,p_target_count integer default 8) returns void
language plpgsql security definer set search_path='' as $$
begin perform private.refresh_next_read(p_user_id,'reserve_replenishment'); end $$;

create function private.edit_next_read_queue(action text, args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; before_q jsonb; after_q jsonb; bid uuid; qid uuid; ids uuid[]; n integer; begin
 u:=private.planner_owner();
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('next-read:'||u::text,0));
 before_q:=private.planner_queue(u);
 qid:=(args->>'queue_id')::uuid;
 if action='add' then
   bid:=(args->>'book_id')::uuid;
   if not exists(select 1 from public.library_entries where user_id=u and book_id=bid
     and overall_status in ('Owned - Unread','Wishlist','Recommended','Paused')) then raise exception 'Book is not eligible for Up Next'; end if;
   if exists(select 1 from public.up_next_queue where user_id=u and book_id=bid and locked) and args->>'source'='AI' then
     raise exception 'AI updates cannot replace a locked selection';
   end if;
   delete from public.up_next_exclusions where user_id=u and book_id=bid;
   if not exists(select 1 from jsonb_array_elements(private.next_read_candidates(u)) x where (x->>'book_id')::uuid=bid) then
     raise exception 'Book is not eligible for Up Next';
   end if;
   select coalesce(max(position),0)+1 into n from public.up_next_queue where user_id=u;
   insert into public.up_next_queue(user_id,book_id,position,source,reason,locked,ai_score,confidence)
   values(u,bid,n,args->>'source',args->>'reason',(args->>'locked')::boolean,(args->>'ai_score')::numeric,args->>'confidence')
   on conflict(user_id,book_id) do update set source=excluded.source,reason=coalesce(excluded.reason,public.up_next_queue.reason),
     locked=excluded.locked,ai_score=excluded.ai_score,confidence=excluded.confidence returning id into qid;
 elsif action='remove' then
   select book_id into bid from public.up_next_queue where user_id=u and id=qid;
   if bid is null then raise exception 'Queue item no longer exists; reload the queue'; end if;
   insert into public.up_next_exclusions(user_id,book_id) values(u,bid) on conflict do nothing;
   delete from public.up_next_queue where user_id=u and id=qid;
 elsif action='lock' then
   update public.up_next_queue set locked=(args->>'locked')::boolean where user_id=u and id=qid;
   if not found then raise exception 'Queue item no longer exists; reload the queue'; end if;
 elsif action='reorder' then
   ids:=array(select x::uuid from jsonb_array_elements_text(args->'queue_ids') x);
   select count(*) into n from public.up_next_queue where user_id=u and id=any(ids);
   if n<>cardinality(ids) or n<>(select count(*) from public.up_next_queue where user_id=u) then
     raise exception 'Queue list must contain every current entry exactly once'; end if;
   update public.up_next_queue q set position=x.ord,locked=case when q.position<>x.ord then true else q.locked end,
     source=case when q.position<>x.ord then 'Manual' else q.source end
     from unnest(ids) with ordinality x(id,ord) where q.user_id=u and q.id=x.id;
 else raise exception 'Invalid queue action'; end if;
 after_q:=private.planner_queue(u);
 insert into public.up_next_refreshes(user_id,reason,before_queue,after_queue) values(u,'manual_'||action,before_q,after_q);
 perform private.mark_up_next_dirty(u,'manual_'||action);
 -- Refill holes immediately, protecting all remaining locks at their requested positions.
 if action='remove' then perform private.refresh_next_read(u,'manual_remove'); end if;
 return jsonb_build_object('queue_id',qid);
end $$;

create or replace function public.up_next_add(p_book_id uuid,p_source text default 'Manual',p_reason text default null,
 p_locked boolean default true,p_ai_score numeric default null,p_confidence text default null) returns uuid
language sql security invoker set search_path='' as $$
 select (private.edit_next_read_queue('add',jsonb_build_object('book_id',p_book_id,'source',p_source,'reason',p_reason,'locked',p_locked,'ai_score',p_ai_score,'confidence',p_confidence))->>'queue_id')::uuid; $$;
create or replace function public.up_next_remove(p_queue_id uuid) returns void
language plpgsql security invoker set search_path='' as $$ begin perform private.edit_next_read_queue('remove',jsonb_build_object('queue_id',p_queue_id)); end $$;
create or replace function public.up_next_set_locked(p_queue_id uuid,p_locked boolean) returns void
language plpgsql security invoker set search_path='' as $$ begin perform private.edit_next_read_queue('lock',jsonb_build_object('queue_id',p_queue_id,'locked',p_locked)); end $$;
create or replace function public.up_next_reorder(p_queue_ids uuid[]) returns void
language plpgsql security invoker set search_path='' as $$ begin perform private.edit_next_read_queue('reorder',jsonb_build_object('queue_ids',p_queue_ids)); end $$;

-- Remove direct API writes to the queue: edits must serialize with refresh and retain history.
-- RLS remains enabled with its original owner policy; the public RPC signatures are unchanged.
revoke insert,update,delete on public.up_next_queue from authenticated;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname in ('planner_owner','mark_up_next_dirty','planner_labels','next_read_candidates','planner_queue',
   'refresh_next_read','next_read_snapshot','next_read_dispatch','planner_set_availability','next_read_changed','edit_next_read_queue',
   'replenish_up_next','remove_started_book_from_up_next'))
 or (n.nspname='public' and p.proname in ('next_read_planning_snapshot','save_next_read_intent','refresh_up_next',
   'acknowledge_next_read_transition','expire_next_read_intent','set_book_availability','up_next_add','up_next_remove','up_next_set_locked','up_next_reorder')) loop
   execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
   if f.nspname='public' or f.proname in ('next_read_dispatch','planner_set_availability','edit_next_read_queue') then
     execute format('grant execute on function %s to authenticated,service_role',f.signature);
   end if;
 end loop;
end $$;
grant usage on schema private to authenticated,service_role;

-- Do not invent intent or seed title-specific priorities. First refresh captures the existing queue.
insert into public.up_next_planner_state(user_id,dirty,reasons)
 select distinct user_id,true,array['planner_installed'] from public.library_entries where user_id is not null
 on conflict(user_id) do update set dirty=true,reasons=array['planner_installed'];
