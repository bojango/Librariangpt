-- Timed periods are not full-book lifecycle sessions. Keep their identity separate.
alter table public.activity_events
  add column timed_session_id uuid references public.reading_time_sessions(id) on delete cascade;
alter table public.activity_events drop constraint activity_events_event_type_check;
alter table public.activity_events add constraint activity_events_event_type_check
  check (event_type in ('wishlist','bought','started','finished','rating','paused','dnf','progress','quotes','librarian','taste','post','sessions'));
alter table public.activity_events add constraint activity_timed_session_type_check
  check ((event_type='sessions') = (timed_session_id is not null));
create unique index activity_timed_session_unique on public.activity_events(timed_session_id)
  where timed_session_id is not null;

-- Browser-authored posts cannot claim a canonical timer or another user's session.
alter policy activity_owner_author on public.activity_events with check (
  private.is_owner() and user_id=(select auth.uid()) and event_type in ('librarian','post')
  and (book_id is null or exists(select 1 from public.library_entries l
    where l.book_id=activity_events.book_id and l.user_id=(select auth.uid())))
  and quote_id is null and session_id is null and timed_session_id is null);

create function private.sync_timed_activity(s public.reading_time_sessions) returns void
language plpgsql security definer set search_path='' as $$
declare meta jsonb;
begin
  -- The default kind is reading even before classification. Await finalisation.
  if s.session_kind<>'reading' or s.ended_at is null or s.ended_at<=s.started_at
    or s.progress_state not in ('submitted','skipped') or s.progress_submitted_at is null then
    -- A legitimate backend correction to Test must also remove its derived post.
    delete from public.activity_events where timed_session_id=s.id;
    return;
  end if;
  meta:=jsonb_build_object('started_at',s.started_at,'ended_at',s.ended_at,
    'duration_seconds',extract(epoch from s.ended_at-s.started_at),
    'pages_read',case when s.progress_state='submitted' and s.end_page>=s.start_page
      then s.end_page-s.start_page end);
  insert into public.activity_events(user_id,idempotency_key,event_type,source,
    occurred_at,book_id,session_id,timed_session_id,metadata,hashtags)
  values(s.user_id,'timed:finished:'||s.id::text,'sessions','system',s.ended_at,
    s.book_id,s.reading_session_id,s.id,meta,array['sessions'])
  on conflict (timed_session_id) where timed_session_id is not null do update set
    user_id=excluded.user_id,occurred_at=excluded.occurred_at,book_id=excluded.book_id,session_id=excluded.session_id,
    metadata=excluded.metadata;
end $$;
revoke all on function private.sync_timed_activity(public.reading_time_sessions) from public,anon,authenticated,service_role;

create function private.capture_timed_activity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.sync_timed_activity(new);
  return new;
end $$;
revoke all on function private.capture_timed_activity() from public,anon,authenticated,service_role;
create trigger activity_timed_capture after insert or update on public.reading_time_sessions
  for each row execute function private.capture_timed_activity();

-- Administrative, idempotent backfill. Never writes to the source session table.
create function private.backfill_timed_activity() returns integer
language plpgsql security definer set search_path='' as $$
declare s public.reading_time_sessions; before_count integer;
begin
  select count(*) into before_count from public.activity_events where event_type='sessions';
  for s in select * from public.reading_time_sessions
    where session_kind='reading' and ended_at>started_at
      and progress_state in ('submitted','skipped') and progress_submitted_at is not null
  loop
    perform private.sync_timed_activity(s);
  end loop;
  return (select count(*)::integer-before_count from public.activity_events where event_type='sessions');
end $$;
revoke all on function private.backfill_timed_activity() from public,anon,authenticated,service_role;
select private.backfill_timed_activity();

-- Test timers may retain their entered page for QA, but must never advance the
-- canonical lifecycle/library progress used by Pages Read or milestone posts.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('private.finish_nfc_reading_session(uuid,integer,boolean)'::regprocedure);
  if position('v_progress := public.update_reading_progress(s.book_id,p_page,''nfc'');' in definition)=0
    then raise exception 'Finish RPC drifted'; end if;
  definition:=replace(definition,
    'v_progress := public.update_reading_progress(s.book_id,p_page,''nfc'');',
    'if s.session_kind=''reading'' then
      v_progress := public.update_reading_progress(s.book_id,p_page,''nfc'');
    end if;');
  execute definition;
end $$;
