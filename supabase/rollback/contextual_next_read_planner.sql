-- Disable contextual planning without deleting its history. For the audited live baseline.
-- Run only as a deliberate rollback; deploy the previous frontend alongside this.
begin;
drop trigger if exists next_read_changed on public.library_entries;
drop trigger if exists next_read_changed on public.reading_sessions;
drop trigger if exists next_read_changed on public.library_events;
drop trigger if exists next_read_changed on public.reading_feedback;
drop trigger if exists next_read_changed on public.taste_profile;
drop trigger if exists next_read_changed on public.recommendations;
CREATE OR REPLACE FUNCTION private.remove_started_book_from_up_next()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.overall_status='Currently Reading' and old.overall_status is distinct from new.overall_status then
    delete from public.up_next_queue where book_id=new.book_id and (user_id=new.user_id or new.user_id is null);
    with ranked as (
      select id,user_id,row_number() over(partition by user_id order by position,added_at) rn
      from public.up_next_queue
    )
    update public.up_next_queue q set position=r.rn from ranked r where q.id=r.id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.up_next_add(p_book_id uuid, p_source text DEFAULT 'Manual'::text, p_reason text DEFAULT NULL::text, p_locked boolean DEFAULT true, p_ai_score numeric DEFAULT NULL::numeric, p_confidence text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_pos integer;
  v_id uuid;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_source not in ('AI','Manual') then raise exception 'Invalid source'; end if;
  select coalesce(max(position),0)+1 into v_pos from public.up_next_queue where user_id=v_uid;
  insert into public.up_next_queue(user_id,book_id,position,source,reason,locked,ai_score,confidence)
  values(v_uid,p_book_id,v_pos,p_source,p_reason,p_locked,p_ai_score,p_confidence)
  on conflict(user_id,book_id) do update set
    source=excluded.source,
    reason=coalesce(excluded.reason,public.up_next_queue.reason),
    locked=excluded.locked,
    ai_score=excluded.ai_score,
    confidence=excluded.confidence,
    updated_at=now()
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.up_next_remove(p_queue_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  delete from public.up_next_queue where id=p_queue_id and user_id=v_uid;
  with ranked as (
    select id,row_number() over(order by position,added_at) rn from public.up_next_queue where user_id=v_uid
  ) update public.up_next_queue q set position=r.rn from ranked r where q.id=r.id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.up_next_reorder(p_queue_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
  v_owned integer;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  select count(*) into v_count from unnest(p_queue_ids) x;
  select count(*) into v_owned from public.up_next_queue where user_id=v_uid and id=any(p_queue_ids);
  if v_count<>v_owned or v_count<>(select count(*) from public.up_next_queue where user_id=v_uid) then
    raise exception 'Queue list must contain every current entry exactly once';
  end if;
  update public.up_next_queue q
  set position=x.ord
  from unnest(p_queue_ids) with ordinality x(id,ord)
  where q.id=x.id and q.user_id=v_uid;
end; $function$
;

CREATE OR REPLACE FUNCTION public.up_next_set_locked(p_queue_id uuid, p_locked boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  update public.up_next_queue set locked=p_locked where id=p_queue_id and user_id=(select auth.uid());
end; $function$
;
grant insert,update,delete on public.up_next_queue to authenticated;
alter table public.up_next_queue drop constraint if exists up_next_unique_position;
revoke all on function public.next_read_planning_snapshot() from public,anon,authenticated,service_role;
revoke all on function public.save_next_read_intent(uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.refresh_up_next(text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.acknowledge_next_read_transition(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.expire_next_read_intent(text) from public,anon,authenticated,service_role;
revoke all on function public.set_book_availability(uuid,text,date) from public,anon,authenticated,service_role;
revoke all on function private.next_read_dispatch(text,uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function private.planner_set_availability(uuid,text,date) from public,anon,authenticated,service_role;
revoke all on function private.edit_next_read_queue(text,jsonb) from public,anon,authenticated,service_role;
commit;
