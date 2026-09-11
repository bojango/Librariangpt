create table public.diagnostic_sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_code text not null unique check (session_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  started_at timestamptz not null,
  ended_at timestamptz,
  uploaded_at timestamptz,
  app_generation text not null,
  app_version text,
  user_agent text,
  platform text,
  display_mode text,
  viewport_width integer,
  viewport_height integer,
  device_pixel_ratio numeric,
  orientation text,
  connection_type text,
  event_count integer not null default 0 check (event_count >= 0),
  issue_count integer not null default 0 check (issue_count >= 0),
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.diagnostic_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.diagnostic_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  occurred_at timestamptz not null,
  monotonic_ms numeric,
  type text not null,
  route text,
  book_id uuid,
  visibility_state text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, sequence)
);

create index diagnostic_sessions_user_started_idx on public.diagnostic_sessions (user_id, started_at desc);
create index diagnostic_events_session_sequence_idx on public.diagnostic_events (session_id, sequence);
create index diagnostic_events_user_occurred_idx on public.diagnostic_events (user_id, occurred_at desc);
create index diagnostic_events_type_idx on public.diagnostic_events (type);

alter table public.diagnostic_sessions enable row level security;
alter table public.diagnostic_events enable row level security;

create policy "Users read their diagnostic sessions"
on public.diagnostic_sessions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users create their diagnostic sessions"
on public.diagnostic_sessions for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users update their diagnostic sessions"
on public.diagnostic_sessions for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users read their diagnostic events"
on public.diagnostic_events for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users create their diagnostic events"
on public.diagnostic_events for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.diagnostic_sessions session
    where session.id = session_id and session.user_id = (select auth.uid())
  )
);

create policy "Users update their diagnostic events"
on public.diagnostic_events for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.diagnostic_sessions session
    where session.id = session_id and session.user_id = (select auth.uid())
  )
);

revoke all on table public.diagnostic_sessions from anon;
revoke all on table public.diagnostic_events from anon;
revoke all on sequence public.diagnostic_events_id_seq from anon;
grant select, insert, update on table public.diagnostic_sessions to authenticated;
grant select, insert, update on table public.diagnostic_events to authenticated;
grant usage, select on sequence public.diagnostic_events_id_seq to authenticated;
