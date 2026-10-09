-- Standalone permission hotfix; apply before the stability release.
-- The deployed Edge bridge uses different, service-only RPCs. Observed direct
-- calls use postgres. Neither path needs PUBLIC/anon/authenticated execution.
-- No function body or reading data is changed. Safe to repeat.
do $$ begin
 if to_regprocedure('public.record_reading_checkin_bridge(uuid,uuid,text,integer,integer,text)') is not null then
  revoke execute on function public.record_reading_checkin_bridge(uuid,uuid,text,integer,integer,text) from public,anon,authenticated;
  grant execute on function public.record_reading_checkin_bridge(uuid,uuid,text,integer,integer,text) to service_role;
 end if;
end $$;
