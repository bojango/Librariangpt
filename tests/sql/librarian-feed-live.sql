-- Management SQL acceptance. Every source row, post, receipt and owner change rolls back.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
declare u uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid();b uuid:=gen_random_uuid();b2 uuid:=gen_random_uuid();s uuid:=gen_random_uuid();
  old_feedback uuid;new_feedback uuid;other_feedback uuid;later_feedback uuid;c jsonb;fresh jsonb;r jsonb;again jsonb;
begin
  insert into auth.users(id) values(u),(stranger);
  update private.app_state set owner_user_id=u where singleton;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('test.librarian_owner',u::text,true);
  perform set_config('test.librarian_stranger',stranger::text,true);
  insert into public.reader_profiles(user_id,display_name,handle) values(u,'Fixture reader','Fixture identity');
  insert into public.books(id,title) values(b,'Rollback editorial fixture'),(b2,'Unrelated rollback fixture');
  insert into public.library_entries(user_id,book_id,overall_status,current_page,total_pages) values(u,b,'Currently Reading',100,200),(u,b2,'Owned - Unread',0,200);
  insert into public.reading_sessions(id,user_id,book_id,status,current_page,total_pages) values(s,u,b,'Reading',100,200);
  insert into public.reading_feedback(user_id,book_id,session_id,user_feedback,sentiment,aspect,confidence,created_at)
    values(u,b,s,'The opening feels slow and its pace is leaving me disengaged.','Negative','Pacing / setup','High',now()-interval '2 days') returning id into old_feedback;
  insert into private.librarian_feed_evidence(user_id,book_id,evidence_key,feedback_id,disposition,evidence)
    select user_id,book_id,private.librarian_feedback_key(user_feedback),id,'baseline',private.librarian_feedback_json(f) from public.reading_feedback f where id=old_feedback;
  assert not exists(select 1 from public.librarian_feed_candidates());
  insert into public.reading_feedback(user_id,book_id,session_id,user_feedback,sentiment,aspect,reading_stage,confidence,evidence_strength)
    values(u,b,s,'The pace has picked up and the gradual exploration is keeping me curious.','Positive','Pacing / payoff','Middle','High','Moderate') returning id into new_feedback;
  select value into c from public.librarian_feed_candidates() value;
  assert c->>'book_id'=b::text and c->>'session_id'=s::text;
  assert (c->'eligible_reasons') ? 'changing_opinion';
  assert (c->'eligible_reasons') ? 'reading_milestone';
  insert into public.reading_feedback(user_id,book_id,user_feedback,confidence)
    values(u,b2,'This separate book has an unrelated but meaningful setting.','High') returning id into other_feedback;
  begin
    perform public.publish_librarian_feed_reflection(c->>'candidate_id','The fixture reader has become more engaged as the exploration gathers momentum.',array[other_feedback],'pacing:curiosity:exploration-gains-momentum');
    raise exception 'Unrelated evidence accepted';
  exception when insufficient_privilege then null;end;
  begin
    perform public.publish_librarian_feed_reflection(c->>'candidate_id','The fixture reader has become more engaged as the exploration gathers momentum.',array[new_feedback],'pacing:curiosity:exploration-gains-momentum','changing_opinion',array[other_feedback]);
    raise exception 'Unrelated comparison accepted';
  exception when insufficient_privilege then null;end;
  r:=public.publish_librarian_feed_reflection(c->>'candidate_id','The fixture reader is more engaged now that the exploration has gained momentum, after finding the opening slow.',array[new_feedback],'pacing:curiosity:exploration-gains-momentum','changing_opinion',array[old_feedback]);
  assert r->>'status'='published';
  again:=public.publish_librarian_feed_reflection(c->>'candidate_id','The fixture reader is more engaged now that the exploration has gained momentum, after finding the opening slow.',array[new_feedback],'pacing:curiosity:exploration-gains-momentum','changing_opinion',array[old_feedback]);
  assert again->>'status'='already_published' and again->>'event_id'=r->>'event_id';
  assert (select count(*) from public.activity_events where user_id=u and event_type='librarian')=1;
  assert (select metadata->'feedback_ids'->>0 from public.activity_events where id=(r->>'event_id')::uuid)=new_feedback::text;
  assert (select book_id=b and session_id=s and source='automation' and hashtags @> array['librarian'] from public.activity_events where id=(r->>'event_id')::uuid);
  update public.reading_feedback set confidence='Medium',updated_at=now() where id=new_feedback;
  assert not exists(select 1 from public.librarian_feed_candidates() v where v->>'book_id'=b::text);
  insert into public.reading_feedback(user_id,book_id,session_id,user_feedback,sentiment,aspect,confidence)
    values(u,b,s,'The remote landscape continues to hold my attention without changing my overall reaction.','Mixed','Setting','Medium') returning id into later_feedback;
  assert not exists(select 1 from public.librarian_feed_candidates() v where v->>'book_id'=b::text);
  assert not exists(select 1 from private.librarian_feed_evidence where feedback_id=later_feedback);
  update public.activity_events set occurred_at=now()-interval '1 day' where id=(r->>'event_id')::uuid;
  select v into fresh from public.librarian_feed_candidates() v where v->>'book_id'=b::text;
  again:=public.publish_librarian_feed_reflection(fresh->>'candidate_id','This differently phrased observation should be rejected using its stable topic key.',array[later_feedback],'pacing:curiosity:exploration-gains-momentum');
  assert again->>'status'='duplicate_observation';
  assert not exists(select 1 from private.librarian_feed_evidence where feedback_id=later_feedback);
  update public.reading_sessions set status='Completed',completed_at=now(),current_page=200 where id=s;
  update public.library_entries set overall_status='Read',completed_at=now(),current_page=200 where book_id=b and user_id=u;
  insert into public.reading_feedback(user_id,book_id,session_id,user_feedback,sentiment,aspect,reading_stage,confidence)
    values(u,b,s,'The expedition was absorbing, but the ending left the central mystery unresolved.','Mixed','Overall Review','Post-read','High') returning id into later_feedback;
  begin
    perform public.publish_librarian_feed_reflection(fresh->>'candidate_id','This candidate was discovered before the final feedback was saved.',array[(fresh->'new_feedback'->0->>'id')::uuid],'stale:request:must-rediscover');
    raise exception 'Stale candidate accepted';
  exception when raise_exception then assert sqlerrm like 'Candidate is stale%';end;
  select v into fresh from public.librarian_feed_candidates() v where v->>'book_id'=b::text;
  assert (fresh->'eligible_reasons') ? 'completed_review';
  r:=public.publish_librarian_feed_reflection(fresh->>'candidate_id','The fixture reader found the expedition absorbing, but the unresolved central mystery weakened the ending.',array[later_feedback],'review:absorbing-expedition:unresolved-ending','completed_review');
  assert r->>'status'='published';
  assert (select count(*) from private.librarian_feed_audit where user_id=u and result='published')=2;
  perform set_config('test.librarian_candidate',c->>'candidate_id',true);
end $$;
set local role authenticated;
do $$ begin
  assert (select count(*) from public.activity_events where event_type='librarian')=2;
  begin perform public.librarian_feed_candidates();raise exception 'Browser discovery allowed';exception when insufficient_privilege then null;end;
  begin perform public.publish_librarian_feed_reflection(current_setting('test.librarian_candidate'),'Unauthorised fixture text which must never be published.',array[gen_random_uuid()],'unauthorised:fixture:never-post');
    raise exception 'Browser publishing allowed';exception when insufficient_privilege then null;end;
  begin perform 1 from private.librarian_feed_evidence;raise exception 'Browser evidence audit allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',current_setting('test.librarian_stranger'),true);
set local role authenticated;
do $$ begin assert not exists(select 1 from public.activity_events);end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.librarian_feed_candidates();raise exception 'Anonymous discovery allowed';exception when insufficient_privilege then null;end;
  begin perform 1 from public.activity_events;raise exception 'Anonymous feed allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role service_role;
do $$ begin
  begin perform public.librarian_feed_candidates();raise exception 'Service-role connector discovery allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'Librarian discovery/publishing, evidence, opinion change, completion, idempotent retries, daily limits, duplicate/stale/unrelated rejection and privacy passed; all fixtures rolled back' result;
