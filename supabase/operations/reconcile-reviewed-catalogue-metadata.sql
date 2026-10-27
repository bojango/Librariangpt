-- After retaining reviewed source summaries, reuse already verified metadata.
-- No new provider requests, attempt-budget resets, or retry-deadline changes.
begin;
with completed as (
 update public.catalogue_enrichment_jobs j set status='complete',updated_at=now()
 from public.collection_catalogue_books w
 where w.key=j.work_key and j.status not in ('complete','processing')
  and nullif(w.synopsis,'') is not null and w.publication_year is not null
  and w.cover_url is not null and w.cover_verified_at is not null
 returning j.work_key
)
insert into public.collection_processing_attempts(work_key,stage,outcome,diagnostic)
select work_key,'metadata','reviewed_source_reconciled',
 jsonb_build_object('reason','Reviewed factual description retained; existing verified cover and publication year reused','provider_request',false)
from completed;
update public.collection_catalogue_books w set enrichment_status='complete'
where w.enrichment_status<>'complete' and exists (
 select 1 from public.catalogue_enrichment_jobs j where j.work_key=w.key and j.status='complete'
 ) and nullif(w.synopsis,'') is not null and w.publication_year is not null
 and w.cover_url is not null and w.cover_verified_at is not null;
commit;
