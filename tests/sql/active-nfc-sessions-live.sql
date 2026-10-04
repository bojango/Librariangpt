-- Run through the management SQL connection. Synthetic owner/library only.
-- The temporary owner substitution is transaction-local and never committed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare
  u uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); b2 uuid:=gen_random_uuid();
  bm uuid:=gen_random_uuid(); bm2 uuid:=gen_random_uuid(); rs uuid:=gen_random_uuid();
  s uuid; q uuid; result jsonb; started timestamptz; ended timestamptz; linked uuid;
begin
  insert into auth.users(id) values(u);
  update private.app_state set owner_user_id=u where singleton;
  insert into public.books(id,title) values(b,'Synthetic NFC primary'),(b2,'Synthetic NFC alternate');
  insert into public.library_entries(user_id,book_id,overall_status,current_page,total_pages)
    values(u,b,'Currently Reading',7,100),(u,b2,'Owned - Unread',0,200);
  insert into public.reading_sessions(id,user_id,book_id,status,current_page,total_pages,started_at)
    values(rs,u,b,'Reading',7,100,clock_timestamp());
  insert into public.nfc_bookmarks(id,user_id,name,token_hash,token_hint,pinned_book_id)
    values(bm,u,'Synthetic NFC primary',repeat('0',64),'test',b),
      (bm2,u,'Synthetic NFC alternate',repeat('0',64),'test',null);
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role service_role';
  result:=public.tap_nfc_bookmark(bm,repeat('0',64));
  assert result->>'status'='started'; s:=(result->>'session_id')::uuid;
  assert (select start_page from public.reading_time_sessions where id=s)=7;
  assert (select reading_session_id from public.reading_time_sessions where id=s)=rs;
  assert public.tap_nfc_bookmark(bm2,repeat('0',64))->>'status'='duplicate_ignored';
  assert public.tap_nfc_bookmark(bm,repeat('1',64))->>'status'='unauthorized';
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',u::text,true);
  execute 'set local role authenticated';
  assert public.nfc_session_destination()->>'name'='reading-session-active';
  result:=public.control_nfc_session(s,'change',b2);
  assert result->>'book_id'=b2::text;
  assert (select overall_status from public.library_entries where book_id=b2)='Currently Reading';
  assert (select active_book_id from public.nfc_bookmarks where id=bm)=b2;
  assert (select pinned_book_id from public.nfc_bookmarks where id=bm)=b;
  result:=public.control_nfc_session(s,'restart'); started:=(result->>'started_at')::timestamptz;
  assert (select start_page from public.reading_time_sessions where id=s)=0;
  result:=public.control_nfc_session(s,'end'); ended:=(result->>'ended_at')::timestamptz;
  assert public.nfc_session_destination()->>'name'='reading-session-finish';
  assert (public.control_nfc_session(s,'end')->>'ended_at')::timestamptz=ended;
  begin
    perform public.control_nfc_session(s,'restart'); raise exception 'Ended restart was allowed';
  exception when raise_exception then if sqlerrm<>'Only a running session can be restarted' then raise; end if; end;
  result:=public.control_nfc_session(s,'change',b);
  assert (result->>'started_at')::timestamptz=started;
  assert (result->>'ended_at')::timestamptz=ended;
  assert (select start_page from public.reading_time_sessions where id=s)=7;
  begin
    perform public.finish_nfc_reading_session(s,6,false); raise exception 'Reverse page was allowed';
  exception when raise_exception then if sqlerrm<>'Page cannot reverse session or canonical progress' then raise; end if; end;
  result:=public.finish_nfc_reading_session(s,12,false); assert result->>'status'='submitted';
  perform public.finish_nfc_reading_session(s,13,false);
  assert (select count(*) from public.progress_logs where session_id=rs and source='nfc')=1;
  assert (select ended_at from public.reading_time_sessions where id=s)=ended;
  begin
    perform public.control_nfc_session(s,'change',b2); raise exception 'Submitted change was allowed';
  exception when raise_exception then if sqlerrm<>'Session is already saved or skipped' then raise; end if; end;
  assert public.nfc_session_destination() is null;
  assert not has_column_privilege('authenticated','public.nfc_bookmarks','token_hash','SELECT');
  assert not has_column_privilege('authenticated','public.nfc_bookmarks','active_book_id','UPDATE');
  assert not has_table_privilege('authenticated','public.reading_time_sessions','UPDATE');
  assert not has_table_privilege('anon','public.nfc_pending_starts','SELECT');
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  assert not exists(select 1 from public.reading_time_sessions where id=s);
  begin
    perform public.control_nfc_session(s,'end'); raise exception 'Other user end was allowed';
  exception when raise_exception then if sqlerrm<>'Not authorized' then raise; end if; end;
  execute 'reset role';
  -- Remove current eligibility only for synthetic books and clear their defaults.
  update public.reading_sessions set status='Paused' where user_id=u;
  update public.library_entries set overall_status='Paused' where user_id=u;
  update public.nfc_bookmarks set last_tapped_at=null,active_book_id=null where user_id=u;
  execute 'set local role service_role';
  result:=public.tap_nfc_bookmark(bm,repeat('0',64)); assert result->>'status'='no_current_book';
  q:=(result->>'request_id')::uuid;
  assert public.tap_nfc_bookmark(bm2,repeat('0',64))->>'request_id'=q::text;
  execute 'reset role'; perform set_config('request.jwt.claim.sub',u::text,true);
  execute 'set local role authenticated';
  assert public.nfc_session_destination()->>'name'='reading-session-choose';
  result:=public.control_nfc_session(q,'select',b2); s:=(result->>'session_id')::uuid;
  assert result->>'status'='started';
  assert not exists(select 1 from public.nfc_pending_starts);
  assert (select count(*) from public.reading_time_sessions where user_id=u and progress_state='pending')=1;
  result:=public.control_nfc_session(s,'end');
  assert public.finish_nfc_reading_session(s,null,true)->>'status'='skipped';
  assert public.nfc_session_destination() is null;
  execute 'reset role';
end $$;
rollback;
select 'passed: synthetic active NFC lifecycle, controls, progress, selection and security; rolled back' as result;
