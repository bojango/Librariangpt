-- Management connection only; all synthetic records/owner substitution roll back.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare u uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); b uuid:=gen_random_uuid();
  bookmark uuid:=gen_random_uuid(); lifecycle uuid:=gen_random_uuid(); s uuid:=gen_random_uuid();
  test_timer uuid:=gen_random_uuid(); event uuid; count_before integer;
begin
  insert into auth.users(id) values(u),(stranger);
  update private.app_state set owner_user_id=u where singleton;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('test.foreign_user',stranger::text,true);
  insert into public.books(id,title) values(b,'Rollback-only timer fixture');
  insert into public.library_entries(user_id,book_id,overall_status,current_page,total_pages)
    values(u,b,'Currently Reading',0,200);
  insert into public.reading_sessions(id,user_id,book_id,status,started_at,current_page,total_pages)
    values(lifecycle,u,b,'Reading','2026-10-01',0,200);
  insert into public.nfc_bookmarks(id,user_id,name,token_hash,token_hint)
    values(bookmark,u,'Rollback-only timer',repeat('ab',32),'hint');
  insert into public.reading_time_sessions(id,user_id,bookmark_id,book_id,reading_session_id,started_at,start_page)
    values(s,u,bookmark,b,lifecycle,'2026-10-03T10:00Z',0);
  update public.reading_time_sessions set ended_at='2026-10-03T11:12Z' where id=s;
  assert not exists(select 1 from public.activity_events where timed_session_id=s), 'Pending timer published';
  perform public.finish_nfc_reading_session(s,20,false);
  select id into event from public.activity_events where timed_session_id=s;
  assert event is not null;
  assert (select occurred_at from public.activity_events where id=event)='2026-10-03T11:12Z'::timestamptz;
  assert (select (metadata->>'duration_seconds')::numeric from public.activity_events where id=event)=4320;
  perform public.finish_nfc_reading_session(s,30,false);
  update public.reading_time_sessions set end_page=24 where id=s;
  assert (select count(*) from public.activity_events where timed_session_id=s)=1;
  assert (select id from public.activity_events where timed_session_id=s)=event;
  assert (select (metadata->>'pages_read')::integer from public.activity_events where id=event)=24;
  insert into public.reading_time_sessions(id,user_id,bookmark_id,book_id,reading_session_id,started_at,ended_at,start_page)
    values(test_timer,u,bookmark,b,lifecycle,'2026-10-04T10:00Z','2026-10-04T10:01Z',20);
  perform public.set_nfc_session_kind(test_timer,'test');
  perform public.finish_nfc_reading_session(test_timer,70,false);
  assert not exists(select 1 from public.activity_events where timed_session_id=test_timer), 'Test timer published';
  assert (select current_page from public.reading_sessions where id=lifecycle)=20, 'Test advanced canonical pages';
  assert (select current_page from public.library_entries where book_id=b and user_id=u)=20;
  select count(*) into count_before from public.activity_events where event_type='sessions';
  perform private.backfill_timed_activity();perform private.backfill_timed_activity();
  assert (select count(*) from public.activity_events where event_type='sessions')=count_before;
  perform set_config('test.timed_id',s::text,true);
end $$;
set local role authenticated;
do $$
begin
  assert (select count(*) from public.activity_events where event_type='sessions')=1;
  begin
    insert into public.activity_events(user_id,idempotency_key,event_type,timed_session_id)
      values(auth.uid(),'forged','sessions',current_setting('test.timed_id')::uuid);
    raise exception 'Canonical event spoof allowed';
  exception when insufficient_privilege then null; end;
  begin perform private.backfill_timed_activity(); raise exception 'Backfill allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.foreign_user'),true);
set local role authenticated;
do $$ begin assert not exists(select 1 from public.activity_events); end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from public.activity_events;raise exception 'Anonymous read allowed';
  exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Timed activity, Test exclusion, backfill, privacy and canonical progress passed; all fixtures rolled back' result;
