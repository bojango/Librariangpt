alter table public.reading_time_sessions
  add column session_kind text not null default 'test';

alter table public.reading_time_sessions
  add constraint reading_time_sessions_session_kind_check
  check (session_kind in ('reading','test'));

-- Every timed row that exists before this migration is NFC QA history.
-- Future sessions are real reading unless the user explicitly marks them Test.
alter table public.reading_time_sessions
  alter column session_kind set default 'reading';

create or replace function private.set_nfc_session_kind(
  p_session_id uuid,
  p_session_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s public.reading_time_sessions%rowtype;
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'Not authorized';
  end if;
  if p_session_kind not in ('reading','test') then
    raise exception 'Invalid session type';
  end if;

  select * into s
  from public.reading_time_sessions
  where id = p_session_id and user_id = v_uid
  for update;

  if s.id is null then
    raise exception 'Session not found';
  end if;
  if s.ended_at is null or s.progress_state <> 'pending' then
    raise exception 'Only an ended session awaiting page entry can be classified';
  end if;

  update public.reading_time_sessions
  set session_kind = p_session_kind
  where id = s.id
  returning * into s;

  return jsonb_build_object(
    'status','updated',
    'session_id',s.id,
    'session_kind',s.session_kind
  );
end
$$;

revoke all on function private.set_nfc_session_kind(uuid,text) from public, anon, authenticated, service_role;
grant execute on function private.set_nfc_session_kind(uuid,text) to authenticated;

create or replace function public.set_nfc_session_kind(
  p_session_id uuid,
  p_session_kind text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.set_nfc_session_kind(p_session_id,p_session_kind);
$$;

revoke all on function public.set_nfc_session_kind(uuid,text) from public, anon, authenticated, service_role;
grant execute on function public.set_nfc_session_kind(uuid,text) to authenticated;
