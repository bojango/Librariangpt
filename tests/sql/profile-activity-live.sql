-- Management connection only. Every fixture and temporary owner substitution rolls back.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare u uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
  b uuid:=gen_random_uuid(); s uuid:=gen_random_uuid(); q uuid:=gen_random_uuid();
  post uuid; initial_count bigint; exact_text text:=E'  Test quotation.\n\nExact second line.  ';
begin
  insert into auth.users(id) values(u),(stranger);
  update private.app_state set owner_user_id=u where singleton;
  perform set_config('request.jwt.claim.sub',u::text,true);
  insert into public.books(id,title,primary_genre) values(b,'Rollback-only activity fixture','Science Fiction');
  insert into public.library_entries(user_id,book_id,overall_status,ownership_status,total_pages,current_page)
    values(u,b,'Wishlist','Not Owned',200,0);
  assert (select count(*) from public.activity_events where user_id=u and event_type='wishlist')=1;
  update public.library_entries set overall_status='Wishlist',notes='Metadata only' where book_id=b;
  assert (select count(*) from public.activity_events where user_id=u)=1;
  insert into public.reading_sessions(id,user_id,book_id,status,total_pages,current_page,started_at)
    values(s,u,b,'Reading',200,0,now());
  update public.library_entries set overall_status='Currently Reading',ownership_status='Owned',started_at=now() where book_id=b;
  assert (select count(*) from public.activity_events where user_id=u and event_type='started')=1;
  assert (select count(*) from public.activity_events where user_id=u and event_type='bought')=1;
  update public.reading_sessions set current_page=10 where id=s;
  assert (select count(*) from public.activity_events where user_id=u and event_type='progress')=0;
  update public.reading_sessions set current_page=100 where id=s;
  update public.reading_sessions set current_page=90 where id=s;
  update public.reading_sessions set current_page=100 where id=s;
  assert (select count(*) from public.activity_events where user_id=u and event_type='progress')=1;
  update public.reading_sessions set status='Completed',completed_at=now(),user_rating_5=3.8 where id=s;
  update public.library_entries set overall_status='Read',completed_at=now(),user_rating_5=3.8 where book_id=b;
  assert (select count(*) from public.activity_events where user_id=u and event_type='finished')=1;
  assert (select count(*) from public.activity_events where user_id=u and event_type='rating')=0;
  insert into public.book_quotes(id,user_id,book_id,quote_text,page_start,note) values(q,u,b,exact_text,12,'Original note');
  assert (select metadata->>'quote_text' from public.activity_events where quote_id=q)=exact_text;
  update public.book_quotes set note=null,chapter='Three' where id=q;
  assert (select count(*) from public.activity_events where quote_id=q)=1;
  assert (select metadata->>'note' from public.activity_events where quote_id=q) is null;
  execute 'set local role authenticated';
  post:=public.add_librarian_entry('automation','Rollback-only editorial fixture','rollback-fixture',b,array['progress']);
  assert post=public.add_librarian_entry('automation','Retry same fixture','rollback-fixture',b,array['progress']);
  assert (select count(*) from public.activity_events where user_id=u and event_type='librarian')=1;
  begin
    insert into public.activity_events(user_id,event_type,idempotency_key) values(u,'started','spoof');
    raise exception 'Canonical event spoofing was allowed';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  execute 'set local role service_role';
  post:=public.add_automation_librarian_entry('automation','Rollback-only server fixture','rollback-server',b,array['progress']);
  assert post=public.add_automation_librarian_entry('automation','Retry','rollback-server',b,array['progress']);
  assert (select user_id from public.activity_events where id=post)=u;
  execute 'reset role';
  assert not has_function_privilege('authenticated','public.add_automation_librarian_entry(text,text,text,uuid,text[])','EXECUTE');
  perform set_config('request.jwt.claim.sub',stranger::text,true);
  execute 'set local role authenticated';
  assert (select count(*) from public.activity_events)=0;
  begin
    perform public.add_librarian_entry('automation','Unauthorized','foreign');
    raise exception 'Foreign authoring was allowed';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  assert not has_table_privilege('anon','public.activity_events','SELECT');
  assert not has_function_privilege('anon','public.add_librarian_entry(text,text,text,uuid,text[])','EXECUTE');
  initial_count:=(select count(*) from public.activity_events);
  perform private.backfill_activity();
  assert (select count(*) from public.activity_events)=initial_count;
  raise notice 'Activity capture, idempotency, quotes, Librarian API and owner/anon RLS assertions passed; fixtures will roll back.';
end $$;
rollback;
select 'Activity live assertions passed; all synthetic fixtures rolled back' as result;
