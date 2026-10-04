-- Temporary explicit navigation, independent of timed sessions and reading data.
create table public.app_navigation_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  requested_at timestamptz not null default clock_timestamp(),
  source text not null default 'nfc_book' check (source = 'nfc_book')
);
create index app_navigation_requests_book_idx on public.app_navigation_requests(book_id);
alter table public.app_navigation_requests enable row level security;
create policy owner_navigation_read on public.app_navigation_requests for select to authenticated
  using ((select private.is_owner()) and user_id=(select auth.uid()));
revoke all on public.app_navigation_requests from public,anon,authenticated;
grant select on public.app_navigation_requests to authenticated;
grant all on public.app_navigation_requests to service_role;

-- Service-only invoker: recheck token under the bookmark lock, including owner
-- and library membership. No mutation of bookmark settings/last_tapped_at.
create function public.queue_nfc_book(p_bookmark_id uuid,p_token_hash text,p_book_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b public.nfc_bookmarks%rowtype; v_title text;
begin
  select * into b from public.nfc_bookmarks where id=p_bookmark_id for update;
  if b.id is null or not b.enabled or b.token_hash is distinct from p_token_hash
    or not exists(select 1 from private.app_state where singleton and owner_user_id=b.user_id) then
    return jsonb_build_object('status','unauthorized');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('nfc:'||b.user_id::text,0));
  select bk.title into v_title from public.library_entries l join public.books bk on bk.id=l.book_id
    where l.user_id=b.user_id and l.book_id=p_book_id for share of l,bk;
  if not found then return jsonb_build_object('status','book_not_found'); end if;
  insert into public.app_navigation_requests(user_id,book_id,requested_at,source)
    values(b.user_id,p_book_id,clock_timestamp(),'nfc_book')
    on conflict(user_id) do update set book_id=excluded.book_id,requested_at=excluded.requested_at,source=excluded.source;
  return jsonb_build_object('status','queued','book_id',p_book_id,'book_title',v_title);
end $$;
revoke all on function public.queue_nfc_book(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.queue_nfc_book(uuid,text,uuid) to service_role;

-- Narrow private elevation permits atomic DELETE without granting browser writes.
-- Same per-owner lock as reading NFC taps; higher-priority requests remain intact.
create function private.nfc_app_destination(p_include_book boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid := (select auth.uid()); v_route jsonb; q public.app_navigation_requests%rowtype;
begin
  if v_user is null or not private.is_owner() then raise exception 'Not authorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nfc:'||v_user::text,0));
  v_route := public.nfc_session_destination();
  if v_route is not null then return v_route; end if;
  if p_include_book is not true then return null; end if;
  delete from public.app_navigation_requests where user_id=v_user returning * into q;
  if q.user_id is null then return null; end if;
  -- A removed library entry cannot be opened, even if queued before its removal.
  if not exists(select 1 from public.library_entries where user_id=v_user and book_id=q.book_id) then return null; end if;
  return jsonb_build_object('name','book','bookId',q.book_id);
end $$;
revoke all on function private.nfc_app_destination(boolean) from public,anon,authenticated,service_role;
grant execute on function private.nfc_app_destination(boolean) to authenticated;
create function public.nfc_app_destination(p_include_book boolean default false)
returns jsonb language sql security invoker set search_path='' as $$
  select private.nfc_app_destination(p_include_book);
$$;
revoke all on function public.nfc_app_destination(boolean) from public,anon,authenticated,service_role;
grant execute on function public.nfc_app_destination(boolean) to authenticated;
