revoke all on table public.diagnostic_sessions from anon, authenticated;
revoke all on table public.diagnostic_events from anon, authenticated;
revoke all on sequence public.diagnostic_events_id_seq from anon, authenticated;

grant select, insert, update on table public.diagnostic_sessions to authenticated;
grant select, insert, update on table public.diagnostic_events to authenticated;
grant usage, select on sequence public.diagnostic_events_id_seq to authenticated;
