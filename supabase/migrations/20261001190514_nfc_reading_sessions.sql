-- Timed periods are separate from the existing full-book reading lifecycle.
create table public.nfc_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint text not null check (char_length(token_hint) <= 8),
  enabled boolean not null default true,
  pinned_book_id uuid references public.books(id) on delete set null,
  last_tapped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id)
);
create index nfc_bookmarks_user_idx on public.nfc_bookmarks(user_id);
create index nfc_bookmarks_pinned_book_idx on public.nfc_bookmarks(pinned_book_id);

create table public.reading_time_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bookmark_id uuid not null,
  book_id uuid not null references public.books(id) on delete cascade,
  edition_id uuid references public.editions(id) on delete set null,
  reading_session_id uuid references public.reading_sessions(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz check (ended_at >= started_at),
  start_page integer not null check (start_page >= 0),
  end_page integer check (end_page >= 0),
  progress_state text not null default 'pending' check (progress_state in ('pending','submitted','skipped')),
  progress_submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(bookmark_id,user_id) references public.nfc_bookmarks(id,user_id) on delete cascade,
  check ((progress_state='pending' and progress_submitted_at is null and end_page is null)
    or (ended_at is not null and progress_submitted_at is not null
      and ((progress_state='submitted' and end_page is not null) or (progress_state='skipped' and end_page is null))))
);
-- Also blocks a new period while the previous finishing page is outstanding.
create unique index one_unresolved_reading_time_session_per_user on public.reading_time_sessions(user_id) where progress_state='pending';
create index reading_time_sessions_user_started_idx on public.reading_time_sessions(user_id,started_at desc);
create index reading_time_sessions_bookmark_idx on public.reading_time_sessions(bookmark_id,user_id);
create index reading_time_sessions_book_idx on public.reading_time_sessions(book_id);
create index reading_time_sessions_edition_idx on public.reading_time_sessions(edition_id);
create index reading_time_sessions_lifecycle_idx on public.reading_time_sessions(reading_session_id);
create trigger nfc_bookmarks_updated_at before update on public.nfc_bookmarks for each row execute function private.set_updated_at();
create trigger reading_time_sessions_updated_at before update on public.reading_time_sessions for each row execute function private.set_updated_at();

alter table public.nfc_bookmarks enable row level security;
alter table public.reading_time_sessions enable row level security;
create policy owner_nfc_bookmarks on public.nfc_bookmarks for all to authenticated
  using ((select private.is_owner()) and user_id=(select auth.uid()))
  with check ((select private.is_owner()) and user_id=(select auth.uid()));
create policy owner_reading_time_sessions on public.reading_time_sessions for select to authenticated
  using ((select private.is_owner()) and user_id=(select auth.uid()));
revoke all on public.nfc_bookmarks,public.reading_time_sessions from public,anon,authenticated;
-- Hashes cannot be read by the browser. Capability secrets only live in memory once.
grant select(id,user_id,name,token_hint,enabled,pinned_book_id,last_tapped_at,created_at,updated_at) on public.nfc_bookmarks to authenticated;
grant insert(id,user_id,name,token_hash,token_hint,enabled,pinned_book_id),update(name,token_hash,token_hint,enabled,pinned_book_id) on public.nfc_bookmarks to authenticated;
grant select on public.reading_time_sessions to authenticated;
grant all on public.nfc_bookmarks,public.reading_time_sessions to service_role;

alter table public.progress_logs drop constraint progress_logs_source_check;
alter table public.progress_logs add constraint progress_logs_source_check check (source in ('frontend','chatgpt','migration','manual','import','nfc'));
-- Preserve the live progress RPC byte-for-byte except its source whitelist.
do $$
declare v_definition text;
begin
  v_definition := pg_get_functiondef('public.update_reading_progress(uuid,integer,text)'::regprocedure);
  if position('''frontend'',''chatgpt'',''migration'',''manual'',''import''' in v_definition)=0 then
    raise exception 'Progress RPC whitelist has drifted; review before applying';
  end if;
  execute replace(v_definition,'''frontend'',''chatgpt'',''migration'',''manual'',''import''', '''frontend'',''chatgpt'',''migration'',''manual'',''import'',''nfc''');
end $$;

-- Service-only transaction. The Edge Function verifies SHA-256 in constant time first;
-- rechecking under the bookmark lock closes disable/rotation races.
create function public.tap_nfc_bookmark(p_bookmark_id uuid,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  b public.nfc_bookmarks%rowtype;
  s public.reading_time_sessions%rowtype;
  l public.library_entries%rowtype;
  r public.reading_sessions%rowtype;
  v_now timestamptz;
  v_count integer;
  v_book uuid;
  v_title text;
  v_status text;
begin
  select * into b from public.nfc_bookmarks where id=p_bookmark_id for update;
  if b.id is null or not b.enabled or b.token_hash is distinct from p_token_hash
    or not exists(select 1 from private.app_state where singleton and owner_user_id=b.user_id) then
    return jsonb_build_object('status','unauthorized');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nfc:'||b.user_id::text,0));
  v_now := clock_timestamp();
  select * into s from public.reading_time_sessions where user_id=b.user_id and progress_state='pending' for update;
  if b.last_tapped_at is not null and v_now-b.last_tapped_at < interval '10 seconds' and (s.id is null or s.ended_at is null) then
    return jsonb_build_object('status','duplicate_ignored','session_id',s.id);
  end if;
  if s.id is not null then
    select title into v_title from public.books where id=s.book_id;
    if s.ended_at is not null then
      v_status := 'awaiting_page';
    elsif v_now-s.started_at < interval '10 seconds' then
      return jsonb_build_object('status','duplicate_ignored','session_id',s.id);
    else
      update public.reading_time_sessions set ended_at=v_now where id=s.id returning * into s;
      update public.nfc_bookmarks set last_tapped_at=v_now where id=b.id;
      v_status := 'ended';
    end if;
    return jsonb_build_object('status',v_status,'session_id',s.id,'book_id',s.book_id,'book_title',v_title,
      'started_at',s.started_at,'ended_at',s.ended_at,'duration_seconds',extract(epoch from s.ended_at-s.started_at));
  end if;
  select count(*),min(book_id::text)::uuid into v_count,v_book from public.library_entries where user_id=b.user_id and overall_status='Currently Reading'
    and (b.pinned_book_id is null or book_id=b.pinned_book_id);
  if v_count=0 then return jsonb_build_object('status','no_current_book'); end if;
  if v_count>1 then return jsonb_build_object('status','needs_book_selection'); end if;
  select * into l from public.library_entries where user_id=b.user_id and overall_status='Currently Reading' and book_id=v_book for share;
  if l.id is null then return jsonb_build_object('status','no_current_book'); end if;
  select * into r from public.reading_sessions where user_id=b.user_id and book_id=l.book_id and status='Reading' for share;
  if r.id is null then return jsonb_build_object('status','missing_reading_lifecycle'); end if;
  insert into public.reading_time_sessions(user_id,bookmark_id,book_id,edition_id,reading_session_id,started_at,start_page)
    values(b.user_id,b.id,l.book_id,coalesce(r.edition_id,l.current_edition_id),r.id,v_now,coalesce(r.current_page,l.current_page,0)) returning * into s;
  update public.nfc_bookmarks set last_tapped_at=v_now where id=b.id;
  select title into v_title from public.books where id=l.book_id;
  return jsonb_build_object('status','started','session_id',s.id,'book_id',s.book_id,'book_title',v_title,'started_at',s.started_at);
end $$;
revoke all on function public.tap_nfc_bookmark(uuid,text) from public,anon,authenticated;
grant execute on function public.tap_nfc_bookmark(uuid,text) to service_role;
-- Existing private owner state is intentionally only available server-side.
grant usage on schema private to service_role;
grant select on private.app_state to service_role;

-- Narrow privilege elevation for atomic completion; explicit owner check before
-- any read/write, kept outside the exposed schema. Never accepts a user ID.
create function private.finish_nfc_reading_session(p_session_id uuid,p_page integer,p_skip boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.reading_time_sessions%rowtype; r public.reading_sessions%rowtype; v_progress jsonb;
begin
  if not private.is_owner() or (select auth.uid()) is null then raise exception 'Not authorized'; end if;
  select * into s from public.reading_time_sessions where id=p_session_id and user_id=(select auth.uid()) for update;
  if s.id is null then raise exception 'Session not found'; end if;
  if s.ended_at is null then raise exception 'Session has not ended'; end if;
  if s.progress_state<>'pending' then return jsonb_build_object('status',s.progress_state,'book_id',s.book_id); end if;
  if p_skip then
    update public.reading_time_sessions set progress_state='skipped',progress_submitted_at=clock_timestamp() where id=s.id;
    return jsonb_build_object('status','skipped','book_id',s.book_id);
  end if;
  if p_page is null or p_page<0 then raise exception 'Enter a non-negative current page'; end if;
  select * into r from public.reading_sessions where id=s.reading_session_id and user_id=s.user_id and status='Reading' for update;
  if r.id is null or coalesce(r.edition_id,(select current_edition_id from public.library_entries where book_id=s.book_id and user_id=s.user_id)) is distinct from s.edition_id then
    raise exception 'The book or edition has changed. Skip this page entry and use the normal book progress controls.';
  end if;
  v_progress := public.update_reading_progress(s.book_id,p_page,'nfc');
  update public.reading_time_sessions set end_page=p_page,progress_state='submitted',progress_submitted_at=clock_timestamp() where id=s.id;
  return jsonb_build_object('status','submitted','book_id',s.book_id,'progress',v_progress);
end $$;
revoke all on function private.finish_nfc_reading_session(uuid,integer,boolean) from public,anon;
grant execute on function private.finish_nfc_reading_session(uuid,integer,boolean) to authenticated;
create function public.finish_nfc_reading_session(p_session_id uuid,p_page integer default null,p_skip boolean default false)
returns jsonb language sql security invoker set search_path='' as $$
  select private.finish_nfc_reading_session(p_session_id,p_page,p_skip);
$$;
revoke all on function public.finish_nfc_reading_session(uuid,integer,boolean) from public,anon;
grant execute on function public.finish_nfc_reading_session(uuid,integer,boolean) to authenticated;
