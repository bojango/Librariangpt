-- The unique (session_id, sequence) constraint already owns an equivalent index.
drop index public.diagnostic_events_session_sequence_idx;
