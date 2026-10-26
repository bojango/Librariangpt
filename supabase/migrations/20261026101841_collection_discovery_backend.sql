-- Additive, service-only discovery. Apply only after backup/review approval.
alter table public.enrichment_provider_state drop constraint enrichment_provider_state_provider_check;
alter table public.enrichment_provider_state add constraint enrichment_provider_state_provider_check check(provider in ('google_books','collection_open_library'));
alter table public.collections add column provenance jsonb not null default '{}'::jsonb;
alter table public.collections add column parent_key text references public.collections(key);
alter table public.collection_catalogue_books add column provenance jsonb not null default '{}'::jsonb;
alter table public.collection_memberships add column provenance jsonb not null default '{}'::jsonb;
alter table public.collection_memberships drop constraint collection_memberships_official_number_check;
alter table public.collection_memberships add constraint collection_memberships_official_number_check check(official_number>=0);

create table public.collection_discovery_jobs (
  book_id uuid primary key references public.books(id) on delete cascade,
  revision bigint not null default 1,
  status text not null default 'queued' check(status in ('queued','processing','retry','completed','unresolved','failed')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 5),
  available_at timestamptz not null default now(),
  claim_token uuid,
  locked_at timestamptz,
  checked_at timestamptz,
  last_error text,
  result jsonb,
  updated_at timestamptz not null default now()
);
create index collection_discovery_due on public.collection_discovery_jobs(available_at) where status in ('queued','retry','processing');
alter table public.collection_discovery_jobs enable row level security;
create policy owner_discovery_read on public.collection_discovery_jobs for select to authenticated using(private.is_owner());
revoke all on public.collection_discovery_jobs from public,anon,authenticated,service_role;
grant select on public.collection_discovery_jobs to authenticated;
grant select,insert,update,delete on public.collection_discovery_jobs to service_role;
create table public.collection_discovery_attempts (
  claim_token uuid primary key,
  book_id uuid not null references public.books(id) on delete cascade,
  revision bigint not null,
  attempt_count integer not null,
  outcome text not null check(outcome in ('retry','failed','linked','standalone','unresolved','abandoned')),
  error text,
  diagnostic jsonb,
  finished_at timestamptz not null default now()
);
create index collection_discovery_attempt_book on public.collection_discovery_attempts(book_id,finished_at);
alter table public.collection_discovery_attempts enable row level security;
create policy owner_discovery_attempt_read on public.collection_discovery_attempts for select to authenticated using(private.is_owner());
revoke all on public.collection_discovery_attempts from public,anon,authenticated,service_role;
grant select on public.collection_discovery_attempts to authenticated;
grant select,insert on public.collection_discovery_attempts to service_role;

-- Trigger privilege is deliberately private, fixed-path and not callable by API roles.
create function private.queue_collection_discovery() returns trigger
language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if tg_table_name='books' then target:=new.id;
  elsif tg_table_name='authors' then
    insert into public.collection_discovery_jobs(book_id)
      select book_id from public.book_authors where author_id=new.id
    on conflict(book_id) do update set revision=collection_discovery_jobs.revision+1,status='queued',attempt_count=0,available_at=now(),claim_token=null,locked_at=null,updated_at=now();
    return new;
  else target:=case when tg_op='DELETE' then old.book_id else new.book_id end;
  end if;
  if exists(select 1 from public.books where id=target) then
    insert into public.collection_discovery_jobs(book_id) values(target)
    on conflict(book_id) do update set revision=collection_discovery_jobs.revision+1,status='queued',attempt_count=0,available_at=now(),claim_token=null,locked_at=null,updated_at=now();
  end if;
  if tg_table_name in ('editions','book_authors','book_external_ids') and tg_op='UPDATE' then
    if old.book_id is distinct from new.book_id then
      insert into public.collection_discovery_jobs(book_id) select old.book_id where exists(select 1 from public.books where id=old.book_id)
      on conflict(book_id) do update set revision=collection_discovery_jobs.revision+1,status='queued',attempt_count=0,available_at=now(),claim_token=null,locked_at=null,updated_at=now();
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.queue_collection_discovery() from public,anon,authenticated,service_role;
create trigger collections_book_insert after insert on public.books for each row execute function private.queue_collection_discovery();
create trigger collections_book_identity after update of title,subtitle,original_publication_year,reference_edition_id on public.books
for each row when ((old.title,old.subtitle,old.original_publication_year,old.reference_edition_id) is distinct from (new.title,new.subtitle,new.original_publication_year,new.reference_edition_id)) execute function private.queue_collection_discovery();
create trigger collections_edition_insert_delete after insert or delete on public.editions for each row execute function private.queue_collection_discovery();
create trigger collections_edition_identity after update of book_id,isbn13,isbn10,open_library_work_id,open_library_edition_id,google_books_volume_id,metadata_payload on public.editions
for each row when ((old.book_id,old.isbn13,old.isbn10,old.open_library_work_id,old.open_library_edition_id,old.google_books_volume_id,old.metadata_payload) is distinct from (new.book_id,new.isbn13,new.isbn10,new.open_library_work_id,new.open_library_edition_id,new.google_books_volume_id,new.metadata_payload)) execute function private.queue_collection_discovery();
create trigger collections_authorship after insert or update or delete on public.book_authors for each row execute function private.queue_collection_discovery();
create trigger collections_external_identity after insert or update or delete on public.book_external_ids for each row execute function private.queue_collection_discovery();
create trigger collections_author_name after update of name on public.authors for each row when(old.name is distinct from new.name) execute function private.queue_collection_discovery();
create trigger collections_library_add after insert on public.library_entries for each row execute function private.queue_collection_discovery();
create trigger collections_library_identity after update of book_id,current_edition_id on public.library_entries
for each row when((old.book_id,old.current_edition_id) is distinct from (new.book_id,new.current_edition_id)) execute function private.queue_collection_discovery();

create function public.reconcile_collection_discovery(p_retry boolean default false) returns integer
language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
  insert into public.collection_discovery_jobs(book_id) select id from public.books on conflict(book_id) do nothing;
  get diagnostics n=row_count;
  if p_retry then
    update public.collection_discovery_jobs set revision=revision+1,status='queued',attempt_count=0,available_at=now(),claim_token=null,locked_at=null,updated_at=now()
      where status in ('unresolved','failed');
  end if;
  return n;
end $$;

create function public.claim_collection_discovery(p_limit integer default 2,p_book_id uuid default null)
returns setof public.collection_discovery_jobs language plpgsql security invoker set search_path='' as $$
begin
  insert into public.collection_discovery_attempts(claim_token,book_id,revision,attempt_count,outcome,error)
    select claim_token,book_id,revision,attempt_count,'abandoned','Claim expired after fifteen minutes.' from public.collection_discovery_jobs
    where status='processing' and locked_at<now()-interval '15 minutes' and claim_token is not null
    on conflict(claim_token) do nothing;
  update public.collection_discovery_jobs set status='failed',claim_token=null,locked_at=null,last_error='Retry budget exhausted after abandoned claim.',updated_at=now()
  where status='processing' and locked_at<now()-interval '15 minutes' and attempt_count>=5;
  return query with due as (
    select j.book_id from public.collection_discovery_jobs j
    where (p_book_id is null or j.book_id=p_book_id) and j.attempt_count<5 and
      ((j.status in ('queued','retry') and j.available_at<=now()) or (j.status='processing' and j.locked_at<now()-interval '15 minutes'))
    order by j.available_at,j.book_id for update skip locked limit greatest(1,least(coalesce(p_limit,2),4))
  ) update public.collection_discovery_jobs j set status='processing',attempt_count=j.attempt_count+1,
      claim_token=gen_random_uuid(),locked_at=now(),updated_at=now()
    from due where j.book_id=due.book_id returning j.*;
end $$;

-- Atomic/fenced importer. No canonical book, edition, Library, recommendation,
-- review or personalised path is inserted, updated or deleted here.
create function public.finish_collection_discovery(p_book_id uuid,p_token uuid,p_revision bigint,p_result jsonb,p_error text default null,p_retry_after timestamptz default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.collection_discovery_jobs; w jsonb; c jsonb; m jsonb;
  wk text; ck text; sid uuid; bid uuid; series_name text; mapping jsonb:='{}'::jsonb; conflict_found boolean:=false; existing_number numeric;
begin
  select * into j from public.collection_discovery_jobs where book_id=p_book_id for update;
  if j.status is distinct from 'processing' or j.claim_token is distinct from p_token or j.revision is distinct from p_revision then return false; end if;
  if p_error is not null then
    insert into public.collection_discovery_attempts(claim_token,book_id,revision,attempt_count,outcome,error,diagnostic)
      values(p_token,p_book_id,p_revision,j.attempt_count,case when j.attempt_count>=5 then 'failed' else 'retry' end,left(p_error,4000),p_result)
      on conflict(claim_token) do nothing;
    update public.collection_discovery_jobs set status=case when attempt_count>=5 then 'failed' else 'retry' end,
      available_at=greatest(now()+interval '6 hours'*power(2,attempt_count-1),coalesce(p_retry_after,now())),
      claim_token=null,locked_at=null,last_error=left(p_error,4000),result=p_result,updated_at=now() where book_id=p_book_id;
    return true;
  end if;
  if coalesce(p_result->>'status','') not in ('linked','standalone','unresolved') then raise exception 'Invalid discovery outcome'; end if;
  -- Serialise catalogue imports across different books of the same series.
  perform pg_advisory_xact_lock(73628941);
  for w in select value from jsonb_array_elements(coalesce(p_result->'works','[]')) loop
    bid:=nullif(w->>'book_id','')::uuid;
    -- A series import can reference several canonical books. Revalidate every
    -- referenced identity, not just the job's own revision, before linking it.
    if bid is not null and not exists(select 1 from public.books b where b.id=bid and b.title=w->>'canonical_title'
      and coalesce((select string_agg(a.name,', ' order by ba.author_order) from public.book_authors ba join public.authors a on a.id=ba.author_id where ba.book_id=b.id),'')=w->>'canonical_authors') then
      raise exception 'Canonical identity changed while discovering catalogue: %',bid;
    end if;
    select key into wk from public.collection_catalogue_books where (bid is not null and book_id=bid) or key=w->>'key'
      order by (book_id=bid) desc nulls last limit 1;
    if wk is null then wk:=w->>'key'; end if;
    if exists(select 1 from public.collection_catalogue_books b where b.key=wk and (
      (regexp_replace(lower(normalize(b.title,NFKD)),'[^a-z0-9]','','g')<>regexp_replace(lower(normalize(w->>'title',NFKD)),'[^a-z0-9]','','g')
        and not exists(select 1 from jsonb_array_elements_text(coalesce(w->'aliases','[]')) alias where regexp_replace(lower(normalize(alias,NFKD)),'[^a-z0-9]','','g')=regexp_replace(lower(normalize(b.title,NFKD)),'[^a-z0-9]','','g')))
      or (select array_agg(v order by v) from (select regexp_replace(lower(normalize(a,NFKD)),'[^a-z0-9]','','g') v from unnest(string_to_array(b.authors,',')) a) names)
        is distinct from (select array_agg(v order by v) from (select regexp_replace(lower(normalize(a,NFKD)),'[^a-z0-9]','','g') v from unnest(string_to_array(w->>'authors',',')) a) names))) then
      raise exception 'Catalogue identity conflict: %',wk;
    end if;
    if bid is not null and exists(select 1 from public.collection_catalogue_books where key=wk and book_id is not null and book_id<>bid) then raise exception 'Catalogue canonical link conflict: %',wk; end if;
    insert into public.collection_catalogue_books(key,book_id,title,authors,publication_year,publication_state,format,cover_url,source_url,verified_at,provenance)
    values(wk,bid,w->>'title',w->>'authors',(w->>'publication_year')::integer,coalesce(w->>'publication_state','published'),w->>'format',w->>'cover_url',w->>'source_url',(w->>'verified_at')::date,w)
    on conflict(key) do update set book_id=coalesce(collection_catalogue_books.book_id,excluded.book_id),
      cover_url=coalesce(collection_catalogue_books.cover_url,excluded.cover_url),
      provenance=case when collection_catalogue_books.provenance->>'type'='existing_database' then excluded.provenance else collection_catalogue_books.provenance end,
      source_url=case when collection_catalogue_books.provenance->>'type'='existing_database' then excluded.source_url else collection_catalogue_books.source_url end,
      verified_at=case when collection_catalogue_books.provenance->>'type'='existing_database' then excluded.verified_at else collection_catalogue_books.verified_at end
    where collection_catalogue_books.provenance->>'type'='existing_database'
      or (collection_catalogue_books.book_id is null and excluded.book_id is not null) or (collection_catalogue_books.cover_url is null and excluded.cover_url is not null);
    mapping:=mapping||jsonb_build_object(w->>'key',wk);
  end loop;
  for c in select value from jsonb_array_elements(coalesce(p_result->'collections','[]')) order by case when value->>'kind'='universe' then 0 else 1 end loop
    select key,series_id into ck,sid from public.collections where key=c->>'key';
    if ck is null and c->>'kind'='series' then
      -- Reuse an existing series only with corroborating canonical membership.
      select s.id into sid from public.series s where lower(s.name)=lower(c->>'name') and exists(
        select 1 from public.book_series bs join public.collection_catalogue_books b on b.book_id=bs.book_id
        where bs.series_id=s.id and b.key in (select mapping->>(value->>'work_key') from jsonb_array_elements(c->'members')));
      if sid is null then
        series_name:=c->>'name';
        if exists(select 1 from public.series where lower(name)=lower(c->>'name')) then
          -- Preserve the official display name on collections while the legacy
          -- series table's globally unique name disambiguates separate authors.
          series_name:=series_name||' ['||coalesce(nullif(c->>'identity_authors',''),c->>'key')||']';
          if exists(select 1 from public.series where name=series_name) then raise exception 'Uncorroborated series identity collision: %',series_name; end if;
        end if;
        insert into public.series(name) values(series_name) returning id into sid;
      end if;
      select key into ck from public.collections where series_id=sid;
    end if;
    ck:=coalesce(ck,c->>'key');
    if exists(select 1 from public.collections where key=ck and kind is distinct from c->>'kind') then raise exception 'Collection kind conflict'; end if;
    insert into public.collections(key,series_id,name,kind,description,complete,source_url,provenance,parent_key)
    values(ck,sid,c->>'name',c->>'kind',c->>'description',(c->>'complete')::boolean,c->>'source_url',c,
      case when exists(select 1 from public.collections where key=c->>'parent_key') then c->>'parent_key' else null end)
    on conflict(key) do update set complete=excluded.complete,provenance=excluded.provenance,source_url=excluded.source_url,
      description=case when collections.provenance->>'type'='existing_database' then excluded.description else collections.description end,
      parent_key=coalesce(collections.parent_key,excluded.parent_key)
      where collections.provenance is distinct from excluded.provenance;
    for m in select value from jsonb_array_elements(c->'members') loop
      wk:=mapping->>(m->>'work_key');
      if wk is null then raise exception 'Missing catalogue work'; end if;
      existing_number:=null;
      select official_number into existing_number from public.collection_memberships where collection_key=ck and work_key=wk;
      if existing_number is not null and m->>'official_number' is not null and existing_number is distinct from (m->>'official_number')::numeric then conflict_found:=true; end if;
      insert into public.collection_memberships(collection_key,work_key,official_number,provenance)
      values(ck,wk,(m->>'official_number')::numeric,jsonb_build_object('source_url',c->>'source_url','verified_at',c->>'verified_at'))
      on conflict(collection_key,work_key) do update set official_number=excluded.official_number,provenance=excluded.provenance
        where collection_memberships.official_number is null and excluded.official_number is not null;
      select book_id into bid from public.collection_catalogue_books where key=wk;
      if sid is not null and bid is not null then
        if m->>'official_number' is not null and exists(select 1 from public.book_series where book_id=bid and series_id=sid and series_order is not null and series_order is distinct from (m->>'official_number')::numeric) then conflict_found:=true; end if;
        insert into public.book_series(book_id,series_id,series_order) values(bid,sid,(m->>'official_number')::numeric)
          on conflict(book_id,series_id) do update set series_order=excluded.series_order where book_series.series_order is null and excluded.series_order is not null;
      end if;
    end loop;
    sid:=null; ck:=null;
  end loop;
  update public.collection_discovery_jobs set status=case when conflict_found or p_result->>'status'='unresolved' then 'unresolved' else 'completed' end,
    result=p_result||jsonb_build_object('preserved_conflict',conflict_found),last_error=case when conflict_found then 'Existing series identity or numbering conflicts with verified evidence; preserved for review.' else null end,
    checked_at=now(),claim_token=null,locked_at=null,updated_at=now() where book_id=p_book_id;
  insert into public.collection_discovery_attempts(claim_token,book_id,revision,attempt_count,outcome,error,diagnostic)
    values(p_token,p_book_id,p_revision,j.attempt_count,case when conflict_found then 'unresolved' else p_result->>'status' end,
      case when conflict_found then 'Conflicting pre-existing membership preserved.' else null end,jsonb_build_object('source_url',p_result->>'source_url','reason',p_result->>'reason'))
    on conflict(claim_token) do nothing;
  return true;
end $$;

revoke all on function public.reconcile_collection_discovery(boolean),public.claim_collection_discovery(integer,uuid),public.finish_collection_discovery(uuid,uuid,bigint,jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_collection_discovery(boolean),public.claim_collection_discovery(integer,uuid),public.finish_collection_discovery(uuid,uuid,bigint,jsonb,text,timestamptz) to service_role;
select public.reconcile_collection_discovery();

-- Materialise every recorded legacy relationship so deploying the database
-- catalogue cannot suppress previously visible collections. These assertions are
-- explicitly existing-database evidence, not externally verified bibliographies.
insert into public.collections(key,series_id,name,kind,description,complete,source_url,provenance)
select 'series:'||s.id,s.id,s.name,'series','Recorded canonical series memberships. Full published catalogue awaits external verification.',false,
 'https://supabase.com/dashboard/project/'||'fbbpovieqfsjunmqtxvf'||'/editor',jsonb_build_object('type','existing_database')
from public.series s where exists(select 1 from public.book_series bs where bs.series_id=s.id)
and not exists(select 1 from public.collections c where c.series_id=s.id);
insert into public.collection_catalogue_books(key,book_id,title,authors,publication_year,cover_url,source_url,verified_at,provenance)
select 'book:'||b.id,b.id,b.title,coalesce((select string_agg(a.name,', ' order by ba.author_order) from public.book_authors ba join public.authors a on a.id=ba.author_id where ba.book_id=b.id),''),
 case when b.original_publication_year between 1 and 2200 then b.original_publication_year else null end,b.cover_url_preferred,'https://supabase.com/dashboard/project/fbbpovieqfsjunmqtxvf/editor',current_date,jsonb_build_object('type','existing_database')
from public.books b where exists(select 1 from public.book_series bs where bs.book_id=b.id)
and not exists(select 1 from public.collection_catalogue_books w where w.book_id=b.id);
insert into public.collection_memberships(collection_key,work_key,official_number,provenance)
select c.key,w.key,bs.series_order,jsonb_build_object('type','existing_database') from public.book_series bs
join public.collections c on c.series_id=bs.series_id join public.collection_catalogue_books w on w.book_id=bs.book_id
on conflict(collection_key,work_key) do nothing;

-- Same Vault credentials and pg_cron/pg_net infrastructure as metadata enrichment.
-- Deploy collection-discovery before enabling this schedule in an approved rollout.
select cron.schedule('collection-discovery-every-five-minutes','2-59/5 * * * *',$cron$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/collection-discovery',
  headers := jsonb_build_object('Content-Type','application/json',
    'Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='goodreads_scheduler_service_key'),
    'apikey',(select decrypted_secret from vault.decrypted_secrets where name='goodreads_scheduler_service_key'),
    'x-enrichment-scheduler-token',(select decrypted_secret from vault.decrypted_secrets where name='enrichment_scheduler_token')),
  body := '{"batch_size":2}'::jsonb);
$cron$);
