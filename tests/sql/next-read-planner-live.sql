-- Run as database administrator against the audited project. All test mutations roll back.
-- Titles identify this real-world acceptance scenario only; application logic has no title rules.
begin;
select set_config('request.jwt.claim.sub',(select owner_user_id::text from private.app_state where singleton),true);
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
set local role authenticated;
do $$
declare sid uuid; desired uuid; next_book uuid; qid uuid; saved jsonb; snap jsonb;
 rec_before jsonb; taste_before jsonb; feedback_before jsonb;
begin
 select rs.id into strict sid from public.reading_sessions rs join public.books b on b.id=rs.book_id where b.title='Prey' and rs.status='Reading';
 select id into strict desired from public.books where title='Revelation Space';
 select jsonb_agg(to_jsonb(r) order by id) into rec_before from public.recommendations r;
 select jsonb_agg(to_jsonb(t) order by id) into taste_before from public.taste_profile t;
 select jsonb_agg(to_jsonb(f) order by id) into feedback_before from public.reading_feedback f;
 perform public.acknowledge_next_read_transition(sid,'asked');
 saved:=public.save_next_read_intent(sid,jsonb_build_object('fiction_nonfiction','Nonfiction',
   'avoided_genres',jsonb_build_array('Science Fiction'),'prefer_shorter',true,'change_of_pace',true,
   'desired_book_ids',jsonb_build_array(desired),'confidence','High'), 'live-acceptance-'||gen_random_uuid()::text);
 assert (saved->>'refreshed')::boolean;
 assert (select count(*) from public.up_next_queue)=8;
 assert (select count(distinct book_id) from public.up_next_queue)=8;
 assert (select count(*) from public.up_next_queue q join public.library_entries le
   on le.user_id=q.user_id and le.book_id=q.book_id where le.ownership_status in ('Owned','Borrowed'))>=6;
 assert (select count(*) from public.up_next_queue q join public.library_entries le
   on le.user_id=q.user_id and le.book_id=q.book_id where q.position<=5 and le.ownership_status in ('Owned','Borrowed'))>=4;
 assert not exists(select 1 from public.up_next_queue where ai_score is null or ai_score<1 or ai_score>10);
 assert not exists(select 1 from public.up_next_queue where reason is null or reason ~* '[0-9]+ pages|next fit');
 select book_id,id into next_book,qid from public.up_next_queue where position=1;
 assert next_book<>desired;
 assert (select fiction_nonfiction from public.books where id=next_book)='Nonfiction';
 perform public.up_next_set_locked(qid,true);
 perform public.refresh_up_next('live_lock_verification');
 assert (select position from public.up_next_queue where id=qid)=1;
 perform public.up_next_set_locked(qid,false);
 perform public.set_book_availability(desired,'On Order',null);
 perform public.refresh_up_next('live_on_order_verification');
 snap:=public.next_read_planning_snapshot();
 assert exists(select 1 from jsonb_array_elements(snap->'candidates') c where c->>'book_id'=desired::text and c->>'ownership_status'='On Order');
 assert (select book_id from public.up_next_queue where position=1)<>desired;
 perform public.set_book_availability(desired,'Owned');
 assert rec_before is not distinct from (select jsonb_agg(to_jsonb(r) order by id) from public.recommendations r);
 assert taste_before is not distinct from (select jsonb_agg(to_jsonb(t) order by id) from public.taste_profile t);
 assert feedback_before is not distinct from (select jsonb_agg(to_jsonb(f) order by id) from public.reading_feedback f);
 perform public.start_reading(next_book);
 assert (public.next_read_planning_snapshot()->'active_intent')='null'::jsonb;
 assert not exists(select 1 from public.up_next_queue where book_id=next_book);
 assert exists(select 1 from public.next_read_intents where id=(saved->>'intent_id')::uuid and expiry_reason='next_book_started');
 perform public.expire_next_read_intent('acceptance_test_complete');
end $$;
select 'live planner RPCs, lifecycle, RLS owner path and history isolation passed; transaction rolled back' as verification;
rollback;
