-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create table if not exists public.up_next_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  position integer not null check (position > 0),
  source text not null default 'AI' check (source in ('AI','Manual')),
  reason text,
  ai_score numeric(4,2) check (ai_score is null or ai_score between 0 and 10),
  confidence text check (confidence is null or confidence in ('Low','Medium','High')),
  locked boolean not null default false,
  notes text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, book_id)
);

create index if not exists up_next_user_position_idx on public.up_next_queue(user_id, position);
create index if not exists up_next_book_idx on public.up_next_queue(book_id);

create trigger up_next_queue_updated_at before update on public.up_next_queue for each row execute function private.set_updated_at();

alter table public.up_next_queue enable row level security;
grant select,insert,update,delete on public.up_next_queue to authenticated;
create policy owner_up_next_queue on public.up_next_queue for all to authenticated
  using (private.is_owner() and user_id=(select auth.uid()))
  with check (private.is_owner() and user_id=(select auth.uid()));

create or replace view public.v_up_next with (security_invoker=true) as
select
  q.id as queue_id,
  q.position,
  q.source,
  q.reason,
  q.ai_score,
  q.confidence,
  q.locked,
  q.notes as queue_notes,
  q.added_at,
  q.updated_at as queue_updated_at,
  v.*,
  r.recommendation_strength,
  r.match_score_10,
  r.why_recommended,
  r.user_interest,
  r.recommendation_status
from public.up_next_queue q
join public.v_library v on v.id=q.book_id
left join lateral (
  select recommendation_strength,match_score_10,why_recommended,user_interest,recommendation_status
  from public.recommendations r
  where r.book_id=q.book_id
  order by r.date_recommended desc nulls last,r.created_at desc
  limit 1
) r on true
where q.user_id=(select auth.uid())
order by q.position;

grant select on public.v_up_next to authenticated;

create or replace function public.up_next_add(
  p_book_id uuid,
  p_source text default 'Manual',
  p_reason text default null,
  p_locked boolean default true,
  p_ai_score numeric default null,
  p_confidence text default null
) returns uuid
language plpgsql
security invoker
set search_path=''
as $$
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
$$;

create or replace function public.up_next_remove(p_queue_id uuid)
returns void
language plpgsql
security invoker
set search_path=''
as $$
declare v_uid uuid := (select auth.uid()); begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  delete from public.up_next_queue where id=p_queue_id and user_id=v_uid;
  with ranked as (
    select id,row_number() over(order by position,added_at) rn from public.up_next_queue where user_id=v_uid
  ) update public.up_next_queue q set position=r.rn from ranked r where q.id=r.id;
end; $$;

create or replace function public.up_next_set_locked(p_queue_id uuid,p_locked boolean)
returns void
language plpgsql
security invoker
set search_path=''
as $$
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  update public.up_next_queue set locked=p_locked where id=p_queue_id and user_id=(select auth.uid());
end; $$;

create or replace function public.up_next_reorder(p_queue_ids uuid[])
returns void
language plpgsql
security invoker
set search_path=''
as $$
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
end; $$;

grant execute on function public.up_next_add(uuid,text,text,boolean,numeric,text) to authenticated;
grant execute on function public.up_next_remove(uuid) to authenticated;
grant execute on function public.up_next_set_locked(uuid,boolean) to authenticated;
grant execute on function public.up_next_reorder(uuid[]) to authenticated;
