-- Stop the endpoint first and export desired timed history before applying.
begin;
drop function public.finish_nfc_reading_session(uuid,integer,boolean);
drop function private.finish_nfc_reading_session(uuid,integer,boolean);
drop function public.tap_nfc_bookmark(uuid,text);
drop table public.reading_time_sessions;
drop table public.nfc_bookmarks;
-- Preserve any existing NFC progress data. Revert whitelist only if unused.
do $$
begin
  if not exists(select 1 from public.progress_logs where source='nfc') then
    execute replace(pg_get_functiondef('public.update_reading_progress(uuid,integer,text)'::regprocedure),
      '''frontend'',''chatgpt'',''migration'',''manual'',''import'',''nfc''',
      '''frontend'',''chatgpt'',''migration'',''manual'',''import''');
    alter table public.progress_logs drop constraint progress_logs_source_check;
    alter table public.progress_logs add constraint progress_logs_source_check
      check (source in ('frontend','chatgpt','migration','manual','import'));
  end if;
end $$;
commit;
