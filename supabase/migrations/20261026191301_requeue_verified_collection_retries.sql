-- Verified local evidence removes the failed provider dependency. Requeue only
-- affected inactive jobs; retain provider backoff and active claim fencing.
create or replace function private.requeue_verified_collection_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='verified' and (tg_op='INSERT' or (old.catalogue,old.status) is distinct from (new.catalogue,new.status)) then
  update public.collection_discovery_jobs j set revision=j.revision+1,status='queued',attempt_count=0,available_at=now(),claim_token=null,locked_at=null,updated_at=now()
  where j.status in ('unresolved','failed','completed','retry') and (
   exists(select 1 from jsonb_array_elements(new.catalogue->'works') w join public.books b on
    regexp_replace(lower(normalize(b.title,NFKD)),'[^a-z0-9]','','g')=regexp_replace(lower(normalize(w->>'title',NFKD)),'[^a-z0-9]','','g')
    or exists(select 1 from jsonb_array_elements_text(coalesce(w->'aliases','[]')) alias where regexp_replace(lower(normalize(b.title,NFKD)),'[^a-z0-9]','','g')=regexp_replace(lower(normalize(alias,NFKD)),'[^a-z0-9]','','g'))
    where b.id=j.book_id)
   or exists(select 1 from jsonb_array_elements(coalesce(j.result->'collections','[]')) c join jsonb_array_elements(new.catalogue->'collections') n on c->>'key'=n->>'key'));
 end if;
 return new;
end $$;
revoke all on function private.requeue_verified_collection_source() from public,anon,authenticated,service_role;
