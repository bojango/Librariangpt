-- Separate ADMIN operation, never a migration. Run only after explicit approval.
-- Set readingroom.approved_collection_worker_revision to the deployed revision
-- after inspecting a successful service-only single-book smoke invocation.
begin;
do $$
begin
 if not exists(select 1 from public.collection_worker_smoke where worker_revision=current_setting('readingroom.approved_collection_worker_revision',true) and tested_at>now()-interval '1 day') then
  raise exception 'A recent smoke test of the explicitly approved worker revision is required';
 end if;
end $$;
select cron.schedule('collection-discovery-every-five-minutes','2-59/5 * * * *',$cron$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/collection-discovery',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='goodreads_scheduler_service_key'),
    'apikey',(select decrypted_secret from vault.decrypted_secrets where name='goodreads_scheduler_service_key'),
    'x-enrichment-scheduler-token',(select decrypted_secret from vault.decrypted_secrets where name='enrichment_scheduler_token')),
  body := '{"batch_size":2}'::jsonb);
$cron$);
commit;
