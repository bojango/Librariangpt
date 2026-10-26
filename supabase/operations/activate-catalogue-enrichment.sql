-- Separate administrator activation after a successful hosted single-work smoke.
-- Set approved_catalogue_revision and catalogue_smoke_request_id in this session
-- to the response actually reviewed. Migrations never activate this schedule.
begin;
do $$
declare response jsonb;
begin
 select content::jsonb into response from net._http_response
 where id=current_setting('readingroom.catalogue_smoke_request_id')::bigint and status_code=200 and created>now()-interval '1 hour';
 if response->>'ok' is distinct from 'true' or response->>'checked' is distinct from '1'
  or response->>'revision' is distinct from current_setting('readingroom.approved_catalogue_revision')
  or response->'outcomes'->0->>'saved' is distinct from 'true'
  or response->'outcomes'->0->>'error' is not null then raise exception 'Successful reviewed hosted catalogue smoke required';end if;
end $$;
select cron.schedule('catalogue-enrichment-every-five-minutes','3-59/5 * * * *',$cron$
 select net.http_post(
  url:=(select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/catalogue-enrichment',
  headers:=jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='goodreads_scheduler_service_key'),
    'apikey',(select decrypted_secret from vault.decrypted_secrets where name='goodreads_scheduler_service_key'),
    'x-enrichment-scheduler-token',(select decrypted_secret from vault.decrypted_secrets where name='enrichment_scheduler_token')),
  body:='{"batch_size":2}'::jsonb,timeout_milliseconds:=110000);
$cron$);
commit;
