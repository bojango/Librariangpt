-- Timed periods remain inside the canonical full-book lifecycle. No history backfill.
alter table public.nfc_bookmarks add column active_book_id uuid references public.books(id) on delete set null;
create index nfc_bookmarks_active_book_idx on public.nfc_bookmarks(active_book_id);
grant select(active_book_id) on public.nfc_bookmarks to authenticated;

create table public.nfc_pending_starts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  bookmark_id uuid not null,
  tapped_at timestamptz not null,
  reason text not null check (reason in ('no_current_book','needs_book_selection')),
  foreign key(bookmark_id,user_id) references public.nfc_bookmarks(id,user_id) on delete cascade
);
create index nfc_pending_starts_bookmark_idx on public.nfc_pending_starts(bookmark_id,user_id);
alter table public.nfc_pending_starts enable row level security;
create policy owner_nfc_pending_starts on public.nfc_pending_starts for select to authenticated
  using ((select private.is_owner()) and user_id=(select auth.uid()));
revoke all on public.nfc_pending_starts from public,anon,authenticated;
grant select on public.nfc_pending_starts to authenticated;
grant all on public.nfc_pending_starts to service_role;

-- Shared defaults also update behind pins, which remain independent hard overrides.
-- Trigger elevation is required because clients cannot write active_book_id.
create function private.follow_reading_activity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.event_type in ('reading_started','progress_updated')
    and new.source not in ('migration','import')
    and exists(select 1 from private.app_state where singleton and owner_user_id=new.user_id)
    and exists(select 1 from public.library_entries l join public.reading_sessions r
      on r.book_id=l.book_id and r.user_id=l.user_id
      where l.user_id=new.user_id and l.book_id=new.book_id and l.overall_status='Currently Reading'
      and r.status='Reading' and r.completed_at is null) then
    perform id from public.nfc_bookmarks where user_id=new.user_id and enabled order by id for update;
    update public.nfc_bookmarks set active_book_id=new.book_id where user_id=new.user_id and enabled;
  end if;
  return new;
end $$;
revoke all on function private.follow_reading_activity() from public,anon,authenticated;
create trigger nfc_follow_reading_activity after insert on public.library_events
  for each row execute function private.follow_reading_activity();

create function private.nfc_eligible_books(p_user uuid)
returns table(book_id uuid,reading_session_id uuid,edition_id uuid,start_page integer)
language sql stable security invoker set search_path='' as $$
  select l.book_id,r.id,coalesce(r.edition_id,l.current_edition_id),coalesce(r.current_page,l.current_page,0)
  from public.library_entries l join public.reading_sessions r on r.book_id=l.book_id and r.user_id=l.user_id
  where l.user_id=p_user and l.overall_status='Currently Reading' and r.status='Reading'
    and r.completed_at is null and l.completed_at is null
    and (r.edition_id is null or l.current_edition_id is null or r.edition_id=l.current_edition_id)
$$;
revoke all on function private.nfc_eligible_books(uuid) from public,anon,authenticated;
grant execute on function private.nfc_eligible_books(uuid) to service_role;

create function private.resolve_nfc_book(p_user uuid,p_pin uuid,p_active uuid) returns uuid
language sql stable security invoker set search_path='' as $$
  with eligible as (select * from private.nfc_eligible_books(p_user)),
  signals as (
    select e.book_id,0 priority,null::timestamptz at from eligible e where e.book_id=p_pin
    union all select e.book_id,1,null from eligible e where e.book_id=p_active
    union all select e.book_id,2,t.started_at from eligible e join public.reading_time_sessions t
      on t.book_id=e.book_id and t.reading_session_id=e.reading_session_id and t.user_id=p_user
      where t.ended_at-t.started_at >= interval '10 seconds'
    union all select e.book_id,3,p.logged_at from eligible e join public.progress_logs p
      on p.book_id=e.book_id and p.session_id=e.reading_session_id and p.user_id=p_user
      where p.source not in ('migration','import')
    union all select e.book_id,4,v.occurred_at from eligible e join public.library_events v
      on v.book_id=e.book_id and v.session_id=e.reading_session_id and v.user_id=p_user
      where v.event_type='reading_started' and v.source not in ('migration','import')
    union all select e.book_id,5,r.started_at from eligible e join public.reading_sessions r on r.id=e.reading_session_id
      where r.started_at is not null
    union all select e.book_id,6,null from eligible e where (select count(*) from eligible)=1
  ), best as (select * from signals where priority=(select min(priority) from signals)),
  latest as (select distinct book_id from best where at is not distinct from (select max(at) from best))
  select book_id from latest where (select count(*) from latest)=1
$$;
revoke all on function private.resolve_nfc_book(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.resolve_nfc_book(uuid,uuid,uuid) to service_role;

create function private.nfc_session_result(s public.reading_time_sessions,p_status text) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('status',p_status,'session_id',s.id,'book_id',s.book_id,
    'book_title',(select title from public.books where id=s.book_id),'started_at',s.started_at,
    'ended_at',s.ended_at,'duration_seconds',case when s.ended_at is not null then floor(extract(epoch from s.ended_at-s.started_at)) end)
$$;
revoke all on function private.nfc_session_result(public.reading_time_sessions,text) from public,anon,authenticated;
grant execute on function private.nfc_session_result(public.reading_time_sessions,text) to service_role;

create or replace function public.tap_nfc_bookmark(p_bookmark_id uuid,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  b public.nfc_bookmarks%rowtype; s public.reading_time_sessions%rowtype;
  r public.reading_sessions%rowtype; l public.library_entries%rowtype;
  q public.nfc_pending_starts%rowtype; v_book uuid; v_now timestamptz; v_reason text;
begin
  select * into b from public.nfc_bookmarks where id=p_bookmark_id;
  if b.id is null or not b.enabled or b.token_hash is distinct from p_token_hash
    or not exists(select 1 from private.app_state where singleton and owner_user_id=b.user_id) then
    return jsonb_build_object('status','unauthorized');
  end if;
  -- All NFC transitions lock the user first, avoiding cross-bookmark lock inversion.
  perform pg_advisory_xact_lock(hashtextextended('nfc:'||b.user_id::text,0));
  select * into s from public.reading_time_sessions where user_id=b.user_id and progress_state='pending' for update;
  if s.id is null then
    select * into q from public.nfc_pending_starts where user_id=b.user_id;
    if q.id is null then
      select * into b from public.nfc_bookmarks where id=p_bookmark_id;
      v_book := private.resolve_nfc_book(b.user_id,b.pinned_book_id,b.active_book_id);
      if v_book is not null then
        -- Canonical lifecycle locks precede bookmark locks, just as Start/Progress do.
        select * into r from public.reading_sessions where user_id=b.user_id and book_id=v_book and status='Reading' for share;
        select * into l from public.library_entries where user_id=b.user_id and book_id=v_book for share;
        if not exists(select 1 from private.nfc_eligible_books(b.user_id) where book_id=v_book) then v_book := null; end if;
      end if;
    end if;
  end if;
  -- Recheck capability after locks: disable/rotation cannot race the mutation.
  perform id from public.nfc_bookmarks where user_id=b.user_id order by id for update;
  select * into b from public.nfc_bookmarks where id=p_bookmark_id for update;
  if b.id is null or not b.enabled or b.token_hash is distinct from p_token_hash then
    return jsonb_build_object('status','unauthorized');
  end if;
  if s.id is null and q.id is null and private.resolve_nfc_book(b.user_id,b.pinned_book_id,b.active_book_id) is distinct from v_book then
    raise exception 'Reading choice changed during tap; retry';
  end if;
  v_now := clock_timestamp();
  if s.id is not null then
    if s.ended_at is not null then return private.nfc_session_result(s,'awaiting_page'); end if;
    if v_now-s.started_at < interval '10 seconds' or v_now-b.last_tapped_at < interval '10 seconds' then
      return private.nfc_session_result(s,'duplicate_ignored');
    end if;
    update public.reading_time_sessions set ended_at=v_now where id=s.id returning * into s;
    update public.nfc_bookmarks set last_tapped_at=v_now where id=b.id;
    return private.nfc_session_result(s,'ended');
  end if;
  if q.id is not null then return jsonb_build_object('status',q.reason,'request_id',q.id,'tapped_at',q.tapped_at); end if;
  if v_now-b.last_tapped_at < interval '10 seconds' then return jsonb_build_object('status','duplicate_ignored'); end if;
  if v_book is null then
    v_reason := case when exists(select 1 from private.nfc_eligible_books(b.user_id)) then 'needs_book_selection' else 'no_current_book' end;
    insert into public.nfc_pending_starts(user_id,bookmark_id,tapped_at,reason) values(b.user_id,b.id,v_now,v_reason) returning * into q;
    update public.nfc_bookmarks set last_tapped_at=v_now where id=b.id;
    return jsonb_build_object('status',v_reason,'request_id',q.id,'tapped_at',q.tapped_at);
  end if;
  insert into public.reading_time_sessions(user_id,bookmark_id,book_id,edition_id,reading_session_id,started_at,start_page)
    values(b.user_id,b.id,v_book,coalesce(r.edition_id,l.current_edition_id),r.id,v_now,coalesce(r.current_page,l.current_page,0)) returning * into s;
  update public.nfc_bookmarks set last_tapped_at=v_now where id=b.id;
  update public.nfc_bookmarks set active_book_id=v_book where user_id=b.user_id and enabled;
  return private.nfc_session_result(s,'started');
end $$;

-- Narrow private elevation: browser has SELECT only on timed/pending state.
-- Owner checked before every lookup; never accepts a user_id from the caller.
create function private.control_nfc_session(p_id uuid,p_action text,p_book_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := (select auth.uid()); s public.reading_time_sessions%rowtype;
  q public.nfc_pending_starts%rowtype; l public.library_entries%rowtype; r public.reading_sessions%rowtype;
begin
  if v_uid is null or not private.is_owner() then raise exception 'Not authorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nfc:'||v_uid::text,0));
  if p_action in ('select','cancel') then
    select * into q from public.nfc_pending_starts where id=p_id and user_id=v_uid for update;
    if q.id is null then raise exception 'Pending request not found'; end if;
    if p_action='cancel' then
      delete from public.nfc_pending_starts where id=q.id;
      return jsonb_build_object('status','cancelled');
    end if;
    if exists(select 1 from public.reading_time_sessions where user_id=v_uid and progress_state='pending') then raise exception 'Resolve the existing timed session first'; end if;
    if not exists(select 1 from public.nfc_bookmarks where id=q.bookmark_id and user_id=v_uid and enabled) then raise exception 'Bookmark is disabled'; end if;
  else
    select * into s from public.reading_time_sessions where id=p_id and user_id=v_uid for update;
    if s.id is null then raise exception 'Session not found'; end if;
    if s.progress_state<>'pending' then raise exception 'Session is already saved or skipped'; end if;
    if p_action='end' then
      if s.ended_at is null then
        update public.reading_time_sessions set ended_at=clock_timestamp() where id=s.id returning * into s;
      end if;
      return private.nfc_session_result(s,'ended');
    end if;
    if p_action='restart' and s.ended_at is not null then raise exception 'Only a running session can be restarted'; end if;
    if p_action not in ('change','restart') then raise exception 'Unknown session action'; end if;
  end if;
  if p_action='restart' then p_book_id := s.book_id; end if;
  -- Lock the book before inspecting/creating its lifecycle. Start Reading itself
  -- remains canonical, including its Paused -> Reading resume path.
  perform 1 from public.books where id=p_book_id for update;
  select * into r from public.reading_sessions where user_id=v_uid and book_id=p_book_id and status='Reading' for update;
  select * into l from public.library_entries where user_id=v_uid and book_id=p_book_id for update;
  if l.id is null then raise exception 'Book is not in your library'; end if;
  if p_action='restart' then
    if not exists(select 1 from private.nfc_eligible_books(v_uid) where book_id=p_book_id and reading_session_id=s.reading_session_id and edition_id is not distinct from s.edition_id) then
      raise exception 'The book or edition has changed';
    end if;
  elsif r.id is null then
    if l.overall_status='Currently Reading' then raise exception 'Missing reading lifecycle; use normal book controls'; end if;
    -- Finished/DNF requires an explicit normal reread decision, never an implicit one.
    if l.overall_status not in ('Owned - Unread','Paused','Wishlist','Recommended') then raise exception 'Start or resume this book using normal book controls first'; end if;
    perform public.start_reading(p_book_id,l.current_edition_id,l.total_pages);
    select * into r from public.reading_sessions where user_id=v_uid and book_id=p_book_id and status='Reading';
    select * into l from public.library_entries where user_id=v_uid and book_id=p_book_id;
  end if;
  if not exists(select 1 from private.nfc_eligible_books(v_uid) where book_id=p_book_id) then raise exception 'Book has no safe active reading lifecycle'; end if;
  if p_action='select' then
    -- Confirmation time is intentional: page snapshot/lifecycle begins now; an
    -- arbitrarily old unresolved tap must not invent hours of reading or predate Start.
    insert into public.reading_time_sessions(user_id,bookmark_id,book_id,edition_id,reading_session_id,started_at,start_page)
      values(v_uid,q.bookmark_id,p_book_id,coalesce(r.edition_id,l.current_edition_id),r.id,clock_timestamp(),coalesce(r.current_page,l.current_page,0)) returning * into s;
    delete from public.nfc_pending_starts where id=q.id;
  else
    update public.reading_time_sessions set book_id=p_book_id,reading_session_id=r.id,
      edition_id=coalesce(r.edition_id,l.current_edition_id),start_page=coalesce(r.current_page,l.current_page,0),
      started_at=case when p_action='restart' then clock_timestamp() else started_at end
      where id=s.id returning * into s;
  end if;
  perform id from public.nfc_bookmarks where user_id=v_uid and enabled order by id for update;
  update public.nfc_bookmarks set active_book_id=p_book_id where user_id=v_uid and enabled;
  return private.nfc_session_result(s,case when s.ended_at is null then 'started' else 'awaiting_page' end);
end $$;
revoke all on function private.control_nfc_session(uuid,text,uuid) from public,anon;
grant execute on function private.control_nfc_session(uuid,text,uuid) to authenticated;
create function public.control_nfc_session(p_id uuid,p_action text,p_book_id uuid default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.control_nfc_session(p_id,p_action,p_book_id);
$$;
revoke all on function public.control_nfc_session(uuid,text,uuid) from public,anon;
grant execute on function public.control_nfc_session(uuid,text,uuid) to authenticated;

-- One owner-scoped snapshot, finish > running > selection. No browser hash needed.
create function public.nfc_session_destination() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s public.reading_time_sessions%rowtype; q public.nfc_pending_starts%rowtype;
begin
  if (select auth.uid()) is null or not private.is_owner() then raise exception 'Not authorized'; end if;
  select * into s from public.reading_time_sessions where user_id=(select auth.uid()) and progress_state='pending';
  if s.id is not null then return jsonb_build_object('name',case when s.ended_at is null then 'reading-session-active' else 'reading-session-finish' end,'sessionId',s.id); end if;
  select * into q from public.nfc_pending_starts where user_id=(select auth.uid());
  if q.id is not null then return jsonb_build_object('name','reading-session-choose','sessionId',q.id); end if;
  return null;
end $$;
revoke all on function public.nfc_session_destination() from public,anon;
grant execute on function public.nfc_session_destination() to authenticated;

-- Extend existing completion validation in place without duplicating progress RPC.
do $$
declare v_definition text;
begin
  v_definition := pg_get_functiondef('private.finish_nfc_reading_session(uuid,integer,boolean)'::regprocedure);
  if position('v_progress := public.update_reading_progress' in v_definition)=0 then raise exception 'Finish RPC drifted'; end if;
  v_definition := replace(v_definition,'v_progress := public.update_reading_progress',
    'if p_page < s.start_page or p_page < coalesce(r.current_page,0) then raise exception ''Page cannot reverse session or canonical progress''; end if;
  if r.book_id is distinct from s.book_id or not exists(select 1 from private.nfc_eligible_books(s.user_id) where book_id=s.book_id and reading_session_id=s.reading_session_id) then raise exception ''The book or edition has changed''; end if;
  v_progress := public.update_reading_progress');
  execute v_definition;
end $$;
