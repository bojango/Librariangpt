-- Strengthen immediate availability, add contextual fit, and explain each queue choice.
-- The prior migrations and their live history remain unchanged.
create or replace function private.next_read_candidates(u uuid) returns jsonb
language sql stable set search_path='' as $$
with intent as (
  select * from public.next_read_intents where user_id=u and state='active'
), recent as (
  select b.title as current_title,b.primary_genre, rs.total_pages, rs.current_page, rs.id, rs.started_at, rs.last_progress_at
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
  select le.book_id,b.title,b.fiction_nonfiction,b.primary_genre,b.themes_tags,
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
   (not deferred and conflicts=0 and ((desired and soon) or (appetite_matches>=3 and coalesce(match_score_10,0)>=9.5 and availability=0))) exceptional_unowned,
   round(greatest(1,least(10,
     6.0 + appetite_matches * 0.48 - conflicts * 1.25
     - case when deferred then 2 else 0 end
     + case when desired then 0.45 else 0 end + case when soon then 0.3 else 0 end
     + greatest(-0.4,least(0.4,(taste_signal+feedback_signal)*0.12))
     + contrast*0.22 + case availability when 2 then 0.4 when 1 then 0.15 else -0.25 end
     + acquisition_signal*0.12 + (coalesce(match_score_10,5)-5)*0.1
   ))::numeric,1) next_fit,
   (case when deferred then
       'You have set '||title||' aside for this reading transition, so it stays in view for later rather than taking an immediate slot.'
     when conflicts>0 then
       'You still have a reason to keep '||title||' in mind'
       ||case when desired then ' because you explicitly want to read it' else '' end
       ||', but it cuts against your current appetite after '
       ||coalesce((select current_title from recent limit 1),'your current book')||'. '
       ||case when pages>(select total_pages from recent limit 1) then 'Another longer read would work better once you want that commitment again.'
         when fiction_nonfiction='Fiction' and (select fiction_nonfiction from intent limit 1)='Nonfiction'
           then 'It can wait until you feel ready to return to fiction.'
         else 'It may fit better once this temporary change of pace has passed.' end
     when intent_id is not null then
       'After '||coalesce((select current_title from recent limit 1),'your current book')||', '
       ||title||' offers '
       ||case when contrast>0 then 'a change of pace through ' else 'a timely route into ' end
       ||coalesce(lower(primary_genre),lower(fiction_nonfiction),'a different subject')
       ||'. Your current lean toward '
       ||coalesce(lower((select fiction_nonfiction from intent limit 1)), 'a different kind of read')
       ||case when pages<=(select preferred_max_pages from intent limit 1) then ' and a shorter commitment' else '' end
       ||' makes it more suitable now than a book chosen on general compatibility alone.'
       ||case when desired then ' You have also singled it out as a book you want to read.' else '' end
     else
       title||' brings '
       ||coalesce(lower(primary_genre),lower(fiction_nonfiction),'a fresh direction')
       ||case when contrast>0 then ' after your recent reading, offering a clear change of pace.' else ' into your next reading stretch.' end
       ||case when soon then ' You have already marked it as a priority, which makes this a timely moment to consider it.'
         when taste_signal+feedback_signal>0 then ' Your established taste and reading feedback support this choice without relying only on its general recommendation.'
         else ' Its fit comes from the current sequence and the reading options already in your library, rather than recommendation strength alone.' end
       ||case when ownership_status='On Order' and availability=0 then ' Its arrival is still uncertain, so it remains a later possibility.' else '' end
   end) reason
 from signals
)
select coalesce(jsonb_agg(to_jsonb(ranked) order by appetite_tier,appetite_matches desc,
  (desired or soon) desc,compatibility_band desc,contrast desc,availability desc,
  order_signal desc,acquisition_signal desc nulls last,match_score_10 desc nulls last,
  wildcard desc,old_position nulls last,book_id),'[]') from ranked;
$$;

create or replace function private.refresh_next_read(u uuid, why text, force_refresh boolean default true) returns jsonb
language plpgsql set search_path='' as $$
declare candidates jsonb; before_q jsonb; after_q jsonb; c jsonb; chosen uuid[]:='{}';
  bid uuid; pos integer; target integer; result_id uuid; available_exists boolean; visible_unowned integer; total_unowned integer; owned_remaining integer;
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
  available_exists:=exists(select 1 from jsonb_array_elements(candidates) x where (x->>'availability')::integer>=1 and not (x->>'deferred')::boolean);
  for pos in 1..greatest(target,coalesce((select max(position) from public.up_next_queue where user_id=u and locked),0)) loop
    if exists(select 1 from public.up_next_queue where user_id=u and locked and position=pos) then continue; end if;
    exit when cardinality(chosen)>=target;
    select count(*) into visible_unowned from public.up_next_queue q
      where q.user_id=u and q.position<=5 and (q.locked or q.book_id=any(chosen))
        and exists(select 1 from jsonb_array_elements(candidates) x where (x->>'book_id')::uuid=q.book_id and (x->>'availability')::integer=0);
    select count(*) into total_unowned from public.up_next_queue q
      where q.user_id=u and (q.locked or q.book_id=any(chosen))
        and exists(select 1 from jsonb_array_elements(candidates) x where (x->>'book_id')::uuid=q.book_id and (x->>'availability')::integer=0);
    select count(*) into owned_remaining from jsonb_array_elements(candidates) x
      where not ((x->>'book_id')::uuid=any(chosen)) and (x->>'availability')::integer>=1 and not (x->>'deferred')::boolean;
    select x into c from jsonb_array_elements(candidates) with ordinality a(x,ord)
      where not ((x->>'book_id')::uuid=any(chosen))
        -- An unavailable book never takes the first automatic slot ahead of an available option.
        and (pos<>1 or not available_exists or (x->>'availability')::integer>=1
          or ((x->>'desired')::boolean and (x->>'soon')::boolean and (x->>'conflicts')::integer=0))
        -- Availability is a queue composition rule, not a small score bonus.
        and ((x->>'availability')::integer>=1 or owned_remaining=0
          or ((x->>'exceptional_unowned')::boolean)
          or (total_unowned<2 and (pos>5 or visible_unowned<1)))
      order by ord limit 1;
    if c is null then continue; end if;
    bid:=(c->>'book_id')::uuid;
    chosen:=array_append(chosen,bid);
    insert into public.up_next_queue(user_id,book_id,position,source,reason,ai_score,confidence,ranking_details)
    values(u,bid,pos,'AI',c->>'reason',(c->>'next_fit')::numeric,c->>'match_confidence',c)
    on conflict(user_id,book_id) do update set position=excluded.position,
      reason=excluded.reason,ranking_details=excluded.ranking_details,
      ai_score=excluded.ai_score,confidence=excluded.confidence;
  end loop;
  delete from public.up_next_queue where user_id=u and not(book_id=any(chosen));
  -- Keep manual explanations and positions; attach fresh context to the inspectable evidence.
  update public.up_next_queue q set ranking_details=x || jsonb_build_object('position_rule','locked'), ai_score=(x->>'next_fit')::numeric
    from jsonb_array_elements(candidates) x where q.user_id=u and q.locked and q.book_id=(x->>'book_id')::uuid;
  after_q:=private.planner_queue(u);
  insert into public.up_next_refreshes(user_id,reason,before_queue,after_queue,candidates)
    values(u,why,before_q,after_q,candidates) returning id into result_id;
  insert into public.up_next_planner_state(user_id,dirty,reasons,refreshed_at)
    values(u,false,'{}',now()) on conflict(user_id) do update set dirty=false,reasons='{}',refreshed_at=now();
  return jsonb_build_object('refreshed',true,'refresh_id',result_id,'queue_count',jsonb_array_length(after_q));
end $$;

alter table public.up_next_refreshes alter column algorithm_version set default 'context-v2';

create or replace function private.next_read_snapshot(u uuid) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object(
 'version','context-v2','generated_at',now(),'visible_count',5,'target_count',8,'planning_threshold_percent',75,
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


