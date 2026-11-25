-- Serialize interactive edits with the existing planner and return their committed order.
create or replace function private.edit_next_read_queue(action text, args jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; before_q jsonb; after_q jsonb; bid uuid; qid uuid; ids uuid[]; n integer; begin
 u:=private.planner_owner();
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('next-read:'||u::text,0));
 before_q:=private.planner_queue(u);
 qid:=(args->>'queue_id')::uuid;
 if action in ('add','add_first') then
   bid:=(args->>'book_id')::uuid;
   if action='add_first' then
     args:=jsonb_build_object('source','Manual','locked',true,'reason','Added manually from Library.');
   end if;
   if not exists(select 1 from public.library_entries where user_id=u and book_id=bid
     and overall_status in ('Owned - Unread','Wishlist','Recommended','Paused')) then raise exception 'Book is not eligible for Up Next'; end if;
   if exists(select 1 from public.up_next_queue where user_id=u and book_id=bid and locked) and args->>'source'='AI' then
     raise exception 'AI updates cannot replace a locked selection';
   end if;
   delete from public.up_next_exclusions where user_id=u and book_id=bid;
   if not exists(select 1 from jsonb_array_elements(private.next_read_candidates(u)) x where (x->>'book_id')::uuid=bid) then
     raise exception 'Book is not eligible for Up Next';
   end if;
   select coalesce(max(position),0)+1 into n from public.up_next_queue where user_id=u;
   insert into public.up_next_queue(user_id,book_id,position,source,reason,locked,ai_score,confidence)
   values(u,bid,n,args->>'source',args->>'reason',(args->>'locked')::boolean,(args->>'ai_score')::numeric,args->>'confidence')
   on conflict(user_id,book_id) do update set source=excluded.source,reason=coalesce(excluded.reason,public.up_next_queue.reason),
     locked=excluded.locked,ai_score=excluded.ai_score,confidence=excluded.confidence returning id into qid;
   if action='add_first' then
     -- The existing deferrable uniqueness constraint permits the entire move in one update.
     update public.up_next_queue q set position=ordered.new_position
     from (
       select id,row_number() over (order by (id=qid) desc,position,id)::integer new_position
       from public.up_next_queue where user_id=u
     ) ordered
     where q.user_id=u and q.id=ordered.id and q.position<>ordered.new_position;
   end if;
 elsif action='remove' then
   select book_id into bid from public.up_next_queue where user_id=u and id=qid;
   if bid is null then raise exception 'Queue item no longer exists; reload the queue'; end if;
   insert into public.up_next_exclusions(user_id,book_id) values(u,bid) on conflict do nothing;
   delete from public.up_next_queue where user_id=u and id=qid;
 elsif action='lock' then
   update public.up_next_queue set locked=(args->>'locked')::boolean where user_id=u and id=qid;
   if not found then raise exception 'Queue item no longer exists; reload the queue'; end if;
 elsif action='reorder' then
   if args ? 'expected_queue_ids' and args->'expected_queue_ids' is distinct from
     coalesce((select jsonb_agg(x->'id' order by ord) from jsonb_array_elements(before_q) with ordinality a(x,ord)), '[]') then
     raise exception 'Queue order changed' using errcode='40001';
   end if;
   ids:=array(select x::uuid from jsonb_array_elements_text(args->'queue_ids') x);
   select count(*) into n from public.up_next_queue where user_id=u and id=any(ids);
   if n<>cardinality(ids) or n<>(select count(*) from public.up_next_queue where user_id=u) then
     raise exception 'Queue list must contain every current entry exactly once'; end if;
   update public.up_next_queue q set position=x.ord,locked=case when q.position<>x.ord then true else q.locked end,
     source=case when q.position<>x.ord then 'Manual' else q.source end
     from unnest(ids) with ordinality x(id,ord) where q.user_id=u and q.id=x.id;
 else raise exception 'Invalid queue action'; end if;
 after_q:=private.planner_queue(u);
 insert into public.up_next_refreshes(user_id,reason,before_queue,after_queue) values(u,'manual_'||action,before_q,after_q);
 perform private.mark_up_next_dirty(u,'manual_'||action);
 -- Refill holes immediately, protecting all remaining locks at their requested positions.
 if action='remove' then perform private.refresh_next_read(u,'manual_remove'); end if;
 return jsonb_build_object('queue_id',qid);
end $$;

-- Return the same owner-scoped rows as the Home shelf, in the mutation transaction.
-- Keep the original RPCs and return types for existing clients.
create function public.edit_up_next(p_action text,p_args jsonb default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  if p_action='refresh' then
    perform public.refresh_up_next('manual_refresh',true);
  elsif p_action in ('add','add_first') then
    if p_action='add' then
      p_args:=jsonb_build_object('book_id',p_args->>'book_id','source','Manual','locked',true,
        'reason','Added manually from Library.');
    end if;
    perform private.edit_next_read_queue(p_action,p_args);
  elsif p_action in ('remove','lock','reorder') then
    if p_action='reorder' and jsonb_typeof(p_args->'expected_queue_ids') is distinct from 'array' then
      raise exception 'Expected queue order is required' using errcode='22023';
    end if;
    perform private.edit_next_read_queue(p_action,p_args);
  else
    raise exception 'Invalid queue action' using errcode='22023';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(q) order by q.position),'[]') from public.v_up_next q);
end $$;

revoke all on function public.edit_up_next(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.edit_up_next(text,jsonb) to authenticated;
