-- Give each candidate a subject-specific, transition-specific explanation.
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
       'You have set '||title||' aside for this reading transition, so its '
       ||coalesce(lower(primary_genre),'subject')||' direction can wait until you are ready to reconsider it. '
       ||'Keeping it in the wider plan preserves that interest without letting it displace a book you want immediately.'
     when conflicts>0 then
       'You still have a reason to keep '||title||' in mind'
       ||case when desired then ' because you explicitly want to read it' else '' end
       ||', but it cuts against your current appetite after '
       ||coalesce((select current_title from recent limit 1),'your current book')||'. '
       ||case when pages>(select total_pages from recent limit 1) then 'Its longer commitment would work better once you want another substantial read.'
         when fiction_nonfiction='Fiction' and (select fiction_nonfiction from intent limit 1)='Nonfiction'
           then 'It can wait until you feel ready to return to fiction.'
         else 'It may fit better once this temporary change of pace has passed.' end
       ||case when themes_tags[1] is not null then ' Its focus on '||lower(themes_tags[1])||' still makes it worth revisiting.' else '' end
     when intent_id is not null then
       'After '||coalesce((select current_title from recent limit 1),'your current book')||', '
       ||title||' moves into '||coalesce(lower(primary_genre),lower(fiction_nonfiction),'a different subject')
       ||case when themes_tags[1] is not null then ', with a focus on '||lower(themes_tags[1]) else '' end
       ||'. '
       ||case when fiction_nonfiction='Nonfiction' and
           (private.planner_labels((select preferred_genres from intent limit 1)) && private.planner_labels(array['Nonfiction'])
             or (select fiction_nonfiction from intent limit 1)='Nonfiction')
         then 'That follows your temporary lean toward nonfiction'
         when contrast>0 then 'That gives you the change of pace you asked for'
         else 'That fits the direction you described for your next read' end
       ||case when (select prefer_shorter from intent limit 1) and pages<(select total_pages from recent limit 1)
         then ' and is shorter than your current book' else '' end
       ||'. '
       ||case when taste_signal+feedback_signal>0 then 'Your established reading feedback supports this subject while the immediate choice still follows your current appetite.'
         when (select primary_genre from recent limit 1) ilike '%science fiction%' and primary_genre ilike '%science%'
           then 'It keeps a science subject in view while changing the form of the next read.'
         else 'Its subject offers a concrete way to change direction without treating this temporary mood as a permanent taste shift.' end
     else
       title||' explores '||coalesce(lower(primary_genre),lower(fiction_nonfiction),'a fresh direction')
       ||case when themes_tags[1] is not null then ' through '||lower(themes_tags[1]) else '' end||'. '
       ||case when contrast>0 then 'That offers a clear change from your recent reading, which makes it timely in the current sequence.'
         else 'It fits the current reading sequence and remains a practical option for an upcoming slot.' end
       ||case when soon then ' You have also marked this book as a priority, making it more than a general recommendation.'
         when taste_signal+feedback_signal>0 then ' Your established taste and reading feedback support the choice without deciding the immediate order alone.'
         else ' Its place here reflects the wider reading context rather than recommendation strength by itself.' end
       ||case when ownership_status='On Order' and availability=0 then ' Arrival is still uncertain, so it remains a later possibility.' else '' end
   end) reason
 from signals
)
select coalesce(jsonb_agg(to_jsonb(ranked) order by appetite_tier,appetite_matches desc,
  (desired or soon) desc,compatibility_band desc,contrast desc,availability desc,
  order_signal desc,acquisition_signal desc nulls last,match_score_10 desc nulls last,
  wildcard desc,old_position nulls last,book_id),'[]') from ranked;
$$;

