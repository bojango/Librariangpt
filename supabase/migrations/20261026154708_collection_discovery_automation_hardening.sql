-- No schedule or network call occurs when applying this migration.
alter table public.enrichment_provider_state drop constraint enrichment_provider_state_provider_check;
alter table public.enrichment_provider_state add constraint enrichment_provider_state_provider_check check(provider in ('google_books','collection_open_library','collection_publisher'));
alter table public.collections add column catalogue_type text not null default 'series'
  check(catalogue_type in ('series','serialized_novel','limited','unresolved'));
alter table public.collection_discovery_jobs add column registry_revision text;
create table public.collection_source_catalogues (
  key text primary key,
  source_url text not null check(source_url like 'https://%'),
  status text not null check(status in ('candidate','verified','rejected')),
  catalogue jsonb not null,
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  check(status<>'verified' or case when jsonb_typeof(catalogue->'works')='array' and jsonb_typeof(catalogue->'collections')='array'
    then verified_at is not null and jsonb_array_length(catalogue->'works') between 1 and 500 and jsonb_array_length(catalogue->'collections') between 1 and 50 else false end)
);
alter table public.collection_source_catalogues enable row level security;
create policy owner_source_catalogue_read on public.collection_source_catalogues for select to authenticated using(private.is_owner());
revoke all on public.collection_source_catalogues from public,anon,authenticated,service_role;
grant select on public.collection_source_catalogues to authenticated;
grant select,insert,update on public.collection_source_catalogues to service_role;

create function private.requeue_verified_collection_source() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='verified' and (tg_op='INSERT' or (old.catalogue,old.status) is distinct from (new.catalogue,new.status)) then
  update public.collection_discovery_jobs j set revision=j.revision+1,status='queued',attempt_count=0,available_at=now(),claim_token=null,locked_at=null,updated_at=now()
  where j.status in ('unresolved','failed','completed') and (
   exists(select 1 from jsonb_array_elements(new.catalogue->'works') w join public.books b on
    regexp_replace(lower(normalize(b.title,NFKD)),'[^a-z0-9]','','g')=regexp_replace(lower(normalize(w->>'title',NFKD)),'[^a-z0-9]','','g')
    or exists(select 1 from jsonb_array_elements_text(coalesce(w->'aliases','[]')) alias where regexp_replace(lower(normalize(b.title,NFKD)),'[^a-z0-9]','','g')=regexp_replace(lower(normalize(alias,NFKD)),'[^a-z0-9]','','g'))
    where b.id=j.book_id)
   or exists(select 1 from jsonb_array_elements(coalesce(j.result->'collections','[]')) c join jsonb_array_elements(new.catalogue->'collections') n on c->>'key'=n->>'key'));
 end if;
 return new;
end $$;
revoke all on function private.requeue_verified_collection_source() from public,anon,authenticated,service_role;
create trigger verified_collection_source_requeue after insert or update on public.collection_source_catalogues for each row execute function private.requeue_verified_collection_source();

create function public.refresh_collection_registry(p_revision text) returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if length(coalesce(p_revision,'')) not between 8 and 128 then raise exception 'Expected a registry content revision'; end if;
 update public.collection_discovery_jobs set revision=revision+1,status='queued',attempt_count=0,available_at=now(),claim_token=null,locked_at=null,registry_revision=p_revision,updated_at=now()
 -- Completed catalogues also need new releases and revised source assertions.
 -- A content revision causes one recheck, never a reset on every invocation.
 where registry_revision is distinct from p_revision and status in ('unresolved','failed','completed');
 get diagnostics n=row_count;
 update public.collection_discovery_jobs set registry_revision=p_revision where status='queued' and registry_revision is distinct from p_revision;
 return n;
end $$;
revoke all on function public.refresh_collection_registry(text) from public,anon,authenticated;
grant execute on function public.refresh_collection_registry(text) to service_role;

-- Store catalogue classification from verified provenance without deleting any
-- legacy series, memberships or canonical/edition/reader metadata.
create function private.collection_classification_from_provenance() returns trigger language plpgsql set search_path='' as $$
begin
 new.catalogue_type:=case when new.provenance->>'catalogue_type'='serialized_novel' then 'serialized_novel'
   when new.provenance->>'catalogue_type'='limited' then 'limited' else 'series' end;
 return new;
end $$;
revoke all on function private.collection_classification_from_provenance() from public,anon,authenticated,service_role;
create trigger collection_classification before insert or update of provenance on public.collections for each row execute function private.collection_classification_from_provenance();

-- Evidence of an explicit service-only smoke invocation; never self-activates.
create table public.collection_worker_smoke (
 singleton boolean primary key default true check(singleton),
 worker_revision text not null,
 tested_at timestamptz not null default now(),
 book_id uuid not null references public.books(id)
);
alter table public.collection_worker_smoke enable row level security;
revoke all on public.collection_worker_smoke from public,anon,authenticated,service_role;
grant select,insert,update on public.collection_worker_smoke to service_role;
