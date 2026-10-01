-- Controlled acceptance test: all synthetic rows and their progress roll back.
-- Never updates existing production books, lifecycle rows, progress or statuses.
begin;
do $$
declare
  u uuid := (select owner_user_id from private.app_state where singleton);
  b uuid := gen_random_uuid();
  bm uuid := gen_random_uuid();
  rs uuid := gen_random_uuid();
  result jsonb;
  sid uuid;
  ended timestamptz;
begin
  insert into public.books(id,title) values(b,'NFC synthetic rollback-only acceptance');
  insert into public.library_entries(user_id,book_id,overall_status,current_page,total_pages)
    values(u,b,'Currently Reading',7,100);
  insert into public.reading_sessions(id,user_id,book_id,status,current_page,total_pages,started_at)
    values(rs,u,b,'Reading',7,100,clock_timestamp());
  insert into public.nfc_bookmarks(id,user_id,name,token_hash,token_hint,pinned_book_id)
    values(bm,u,'NFC rollback-only acceptance',repeat('0',64),'test',b);
  execute 'set local role service_role';
  result:=public.tap_nfc_bookmark(bm,repeat('1',64));
  assert result->>'status'='unauthorized';
  result:=public.tap_nfc_bookmark(bm,repeat('0',64));
  assert result->>'status'='started';
  sid:=(result->>'session_id')::uuid;
  assert (select start_page from public.reading_time_sessions where id=sid)=7;
  assert (select reading_session_id from public.reading_time_sessions where id=sid)=rs;
  assert public.tap_nfc_bookmark(bm,repeat('0',64))->>'status'='duplicate_ignored';
  update public.nfc_bookmarks set last_tapped_at=clock_timestamp()-interval '30 seconds' where id=bm;
  update public.reading_time_sessions set started_at=clock_timestamp()-interval '30 seconds' where id=sid;
  result:=public.tap_nfc_bookmark(bm,repeat('0',64));
  assert result->>'status'='ended';
  assert (result->>'duration_seconds')::numeric>=30;
  assert public.tap_nfc_bookmark(bm,repeat('0',64))->>'status'='awaiting_page';
  select ended_at into ended from public.reading_time_sessions where id=sid;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',u::text,true);
  execute 'set local role authenticated';
  assert not has_column_privilege('authenticated','public.nfc_bookmarks','token_hash','SELECT');
  assert not has_table_privilege('anon','public.reading_time_sessions','SELECT');
  update public.nfc_bookmarks set name='NFC authenticated configuration acceptance',token_hash=repeat('2',64),enabled=false where id=bm;
  assert (select enabled from public.nfc_bookmarks where id=bm)=false;
  result:=public.finish_nfc_reading_session(sid,12,false);
  assert result->>'status'='submitted';
  assert (select end_page from public.reading_time_sessions where id=sid)=12;
  assert (select ended_at from public.reading_time_sessions where id=sid)=ended;
  assert (select current_page from public.reading_sessions where id=rs)=12;
  assert (select current_page from public.library_entries where book_id=b)=12;
  assert (select source from public.progress_logs where session_id=rs)='nfc';
  assert exists(select 1 from public.library_events where session_id=rs and event_type='progress_updated' and source='nfc');
  perform public.finish_nfc_reading_session(sid,13,false);
  assert (select count(*) from public.progress_logs where session_id=rs)=1;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  assert not exists(select 1 from public.reading_time_sessions where id=sid);
  begin
    perform public.finish_nfc_reading_session(sid,13,false);
    raise exception 'Cross-user access was incorrectly allowed';
  exception when raise_exception then
    if sqlerrm<>'Not authorized' then raise; end if;
  end;
  execute 'reset role';
end $$;
rollback;
