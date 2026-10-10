-- Management connection only. Temporary owner and identity fixtures roll back.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare u uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();
begin
  assert (select column_default is null from information_schema.columns
    where table_schema='public' and table_name='reader_profiles' and column_name='library_name');
  insert into auth.users(id) values(u),(stranger);
  update private.app_state set owner_user_id=u where singleton;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('test.profile_owner',u::text,true);
  perform set_config('test.profile_stranger',stranger::text,true);
  insert into reader_profiles(user_id,display_name,handle,short_bio,avatar_path)
    values(u,'Existing name','Chosen identity','Existing biography','fixture/avatar.png'),(stranger,'Other','Other',null,null);
  assert (select library_name is null from reader_profiles where user_id=u);
end $$;
set local role authenticated;
do $$ begin
  update reader_profiles set library_name='Alder Creek Reading Library' where user_id=auth.uid();
  assert (select library_name from reader_profiles where user_id=auth.uid())='Alder Creek Reading Library';
  assert (select handle from reader_profiles where user_id=auth.uid())='Chosen identity';
  assert (select short_bio from reader_profiles where user_id=auth.uid())='Existing biography';
  assert (select avatar_path from reader_profiles where user_id=auth.uid())='fixture/avatar.png';
  assert (select count(*) from reader_profiles)=1;
  begin
    insert into reader_profiles(user_id,library_name) values(current_setting('test.profile_stranger')::uuid,'Forbidden');
    raise exception 'Foreign authoring allowed';
  exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.profile_stranger'),true);
set local role authenticated;
do $$ begin
  assert not exists(select 1 from reader_profiles);
  update reader_profiles set library_name='Forbidden' where user_id=current_setting('test.profile_owner')::uuid;
  assert not found;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform 1 from reader_profiles;raise exception 'Anonymous profile read allowed';
  exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Library-name creation, casing, identity preservation and owner-only privacy passed; fixtures rolled back' result;
