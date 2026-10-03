-- Management connection only. All synthetic fixtures and owner substitution roll back.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare
  u uuid:=gen_random_uuid(); other_user uuid:=gen_random_uuid();
  b uuid:=gen_random_uuid(); b2 uuid:=gen_random_uuid(); foreign_book uuid:=gen_random_uuid();
  bm uuid:=gen_random_uuid(); foreign_bm uuid:=gen_random_uuid(); rs uuid:=gen_random_uuid();
  result jsonb; s uuid; q uuid; before_data jsonb; after_data jsonb;
begin
  insert into auth.users(id) values(u),(other_user);
  update private.app_state set owner_user_id=u where singleton;
  insert into public.books(id,title) values(b,'Synthetic NFC sticker A'),(b2,'Synthetic NFC sticker B'),(foreign_book,'Synthetic other user');
  insert into public.library_entries(user_id,book_id,overall_status,current_page,total_pages)
    values(u,b,'Wishlist',0,100),(u,b2,'Currently Reading',7,200),(other_user,foreign_book,'Read',0,100);
  insert into public.reading_sessions(id,user_id,book_id,status,current_page,total_pages,started_at)
    values(rs,u,b2,'Reading',7,200,clock_timestamp());
  insert into public.nfc_bookmarks(id,user_id,name,token_hash,token_hint,pinned_book_id)
    values(bm,u,'Synthetic sticker capability',repeat('0',64),'test',b2),
      (foreign_bm,other_user,'Synthetic non-owner',repeat('0',64),'test',null);
  before_data:=jsonb_build_object(
    'library',(select jsonb_agg(to_jsonb(x) order by id) from public.library_entries x),
    'sessions',(select jsonb_agg(to_jsonb(x) order by id) from public.reading_sessions x),
    'timed',(select jsonb_agg(to_jsonb(x) order by id) from public.reading_time_sessions x),
    'progress',(select jsonb_agg(to_jsonb(x) order by id) from public.progress_logs x),
    'events',(select jsonb_agg(to_jsonb(x) order by id) from public.library_events x),
    'bookmarks',(select jsonb_agg(to_jsonb(x) order by id) from public.nfc_bookmarks x));
  execute 'set local role service_role';
  result:=public.queue_nfc_book(bm,repeat('0',64),b);
  assert result=jsonb_build_object('status','queued','book_id',b,'book_title','Synthetic NFC sticker A');
  assert public.queue_nfc_book(bm,repeat('0',64),b2)->>'status'='queued';
  assert (select count(*) from public.app_navigation_requests where user_id=u)=1;
  assert (select book_id from public.app_navigation_requests where user_id=u)=b2;
  assert public.queue_nfc_book(bm,repeat('0',64),foreign_book)='{"status":"book_not_found"}'::jsonb;
  assert public.queue_nfc_book(bm,repeat('0',64),gen_random_uuid())='{"status":"book_not_found"}'::jsonb;
  assert public.queue_nfc_book(bm,repeat('f',64),b)='{"status":"unauthorized"}'::jsonb;
  assert public.queue_nfc_book(foreign_bm,repeat('0',64),foreign_book)='{"status":"unauthorized"}'::jsonb;
  execute 'reset role';
  update public.nfc_bookmarks set enabled=false where id=bm;
  execute 'set local role service_role';
  assert public.queue_nfc_book(bm,repeat('0',64),b)='{"status":"unauthorized"}'::jsonb;
  execute 'reset role';
  update public.nfc_bookmarks set enabled=true where id=bm;
  after_data:=jsonb_build_object(
    'library',(select jsonb_agg(to_jsonb(x) order by id) from public.library_entries x),
    'sessions',(select jsonb_agg(to_jsonb(x) order by id) from public.reading_sessions x),
    'timed',(select jsonb_agg(to_jsonb(x) order by id) from public.reading_time_sessions x),
    'progress',(select jsonb_agg(to_jsonb(x) order by id) from public.progress_logs x),
    'events',(select jsonb_agg(to_jsonb(x) order by id) from public.library_events x),
    'bookmarks',(select jsonb_agg(to_jsonb(x) order by id) from public.nfc_bookmarks x));
  -- Enabled test toggles update only the synthetic bookmark's updated_at.
  assert before_data-'bookmarks'=after_data-'bookmarks';
  assert not has_table_privilege('anon','public.app_navigation_requests','SELECT');
  assert not has_table_privilege('authenticated','public.app_navigation_requests','INSERT,UPDATE,DELETE');
  assert not has_function_privilege('authenticated','public.queue_nfc_book(uuid,text,uuid)','EXECUTE');
  assert not has_function_privilege('anon','public.nfc_app_destination(boolean)','EXECUTE');
  assert not has_function_privilege('anon','private.nfc_app_destination(boolean)','EXECUTE');
  assert not has_column_privilege('authenticated','public.nfc_bookmarks','token_hash','SELECT');
  perform set_config('request.jwt.claim.sub',other_user::text,true);
  execute 'set local role authenticated';
  assert (select count(*) from public.app_navigation_requests)=0;
  begin
    perform public.nfc_app_destination(true); raise exception 'Other user consumed';
  exception when raise_exception then if sqlerrm<>'Not authorized' then raise; end if; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',u::text,true);
  execute 'set local role authenticated';
  assert public.nfc_app_destination(false) is null;
  assert public.nfc_app_destination(true)=jsonb_build_object('name','book','bookId',b2);
  assert public.nfc_app_destination(true) is null;
  execute 'reset role';
  perform public.queue_nfc_book(bm,repeat('0',64),b);
  result:=public.tap_nfc_bookmark(bm,repeat('0',64)); s:=(result->>'session_id')::uuid;
  execute 'set local role authenticated';
  assert public.nfc_app_destination(true)->>'name'='reading-session-active';
  perform public.control_nfc_session(s,'end');
  assert public.nfc_app_destination(true)->>'name'='reading-session-finish';
  assert (select count(*) from public.app_navigation_requests where user_id=u)=1;
  perform public.finish_nfc_reading_session(s,null,true);
  assert public.nfc_app_destination(true)->>'bookId'=b::text;
  execute 'reset role';
  perform public.queue_nfc_book(bm,repeat('0',64),b);
  update public.reading_sessions set status='Paused' where id=rs;
  update public.nfc_bookmarks set last_tapped_at=null where id=bm;
  result:=public.tap_nfc_bookmark(bm,repeat('0',64)); q:=(result->>'request_id')::uuid;
  execute 'set local role authenticated';
  assert public.nfc_app_destination(true)->>'name'='reading-session-choose';
  assert (select count(*) from public.app_navigation_requests where user_id=u)=1;
  perform public.control_nfc_session(q,'cancel');
  assert public.nfc_app_destination(true)->>'bookId'=b::text;
  assert public.nfc_app_destination(true) is null;
  execute 'reset role';
end $$;
rollback;
select 'NFC book links: synthetic queue, priority, consumption, security and rollback passed' as result;
