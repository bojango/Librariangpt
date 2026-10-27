-- Catalogue metadata is global bibliography; personalised assessments are owner scoped.
-- No worker or paid inference is activated by this additive migration.
alter table public.collection_catalogue_books
 add column synopsis text,
 add column metadata_sources jsonb not null default '[]' check(jsonb_typeof(metadata_sources)='array'),
 add column cover_verified_at timestamptz,
 add column cover_locked boolean not null default false,
 add column enrichment_status text not null default 'pending' check(enrichment_status in ('pending','complete','incomplete','retry','failed')),
 add column enrichment_last_attempted_at timestamptz;

create table public.catalogue_enrichment_jobs (
 work_key text primary key references public.collection_catalogue_books(key) on delete cascade,
 status text not null default 'queued' check(status in ('queued','processing','complete','incomplete','retry','failed')),
 available_at timestamptz not null default now(), locked_at timestamptz, claim_token uuid,
 identity_hash text, attempt_count integer not null default 0, last_error text, last_result jsonb,
 last_attempted_at timestamptz, updated_at timestamptz not null default now()
);
create index catalogue_enrichment_due_idx on public.catalogue_enrichment_jobs(status,available_at);
create table public.collection_assessments (
 user_id uuid not null references auth.users(id) on delete cascade,
 work_key text not null references public.collection_catalogue_books(key) on delete cascade,
 verdict text not null default 'pending' check(verdict in ('recommended','optional','not_recommended','pending')),
 appeal text, frustrations text, reasoning text, continuity text,
 match_score_10 numeric(3,1) check(match_score_10 between 0 and 10),
 confidence text check(confidence in ('Low','Medium','High')),
 evidence jsonb not null default '[]' check(jsonb_typeof(evidence)='array'),
 taste_evidence_ids jsonb not null default '[]', taste_version text, content_version text,
 assessed_at timestamptz, pending_reason text not null default 'Awaiting source evidence and individual Librarian review.',
 inference_provenance text, primary key(user_id,work_key),
 check((verdict='recommended' and match_score_10 is not null) or (verdict<>'recommended' and match_score_10 is null)),
 check(verdict='pending' or (length(trim(coalesce(reasoning,'')))>=40 and length(trim(coalesce(appeal,'')))>=15 and length(trim(coalesce(frustrations,'')))>=15
   and confidence is not null and assessed_at is not null and taste_version is not null and jsonb_array_length(evidence)>0))
);
create index collection_assessments_work_idx on public.collection_assessments(work_key);
create table public.collection_assessment_jobs (
 user_id uuid not null references auth.users(id) on delete cascade,
 work_key text not null references public.collection_catalogue_books(key) on delete cascade,
 status text not null default 'queued' check(status in ('queued','processing','complete','pending','retry')),
 taste_version text not null, content_version text not null,
 available_at timestamptz not null default now(), locked_at timestamptz, claim_token uuid,
 attempt_count integer not null default 0, last_error text, last_attempted_at timestamptz,
 primary key(user_id,work_key)
);
create index collection_assessment_due_idx on public.collection_assessment_jobs(status,available_at);
create index collection_assessment_jobs_work_idx on public.collection_assessment_jobs(work_key);
create table public.collection_processing_attempts (
 id bigint generated always as identity primary key,
 work_key text not null references public.collection_catalogue_books(key) on delete cascade,
 user_id uuid references auth.users(id) on delete cascade,
 stage text not null check(stage in ('metadata','assessment')), claim_token uuid,
 outcome text not null, diagnostic jsonb, attempted_at timestamptz not null default now()
);
create index collection_processing_work_idx on public.collection_processing_attempts(work_key,attempted_at);
create index collection_processing_owner_idx on public.collection_processing_attempts(user_id);
create table private.collection_taste_versions (
 user_id uuid primary key references auth.users(id) on delete cascade,
 version text not null, candidate_version text, candidate_since timestamptz, activated_at timestamptz not null default now()
);
create table private.collection_assessment_history (
 id bigint generated always as identity primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 work_key text not null references public.collection_catalogue_books(key) on delete cascade,
 assessment jsonb not null, recorded_at timestamptz not null default now()
);
create index collection_assessment_history_owner_idx on private.collection_assessment_history(user_id,work_key);
alter table public.catalogue_enrichment_jobs enable row level security;
alter table public.collection_assessments enable row level security;
alter table public.collection_assessment_jobs enable row level security;
alter table public.collection_processing_attempts enable row level security;
alter table private.collection_taste_versions enable row level security;
alter table private.collection_assessment_history enable row level security;
create policy owner_assessment_read on public.collection_assessments for select to authenticated
 using(private.is_owner() and user_id=(select auth.uid()));
create policy owner_assessment_job_read on public.collection_assessment_jobs for select to authenticated
 using(private.is_owner() and user_id=(select auth.uid()));
create policy owner_catalogue_job_read on public.catalogue_enrichment_jobs for select to authenticated using(private.is_owner());
create policy owner_collection_attempt_read on public.collection_processing_attempts for select to authenticated
 using(private.is_owner() and (user_id is null or user_id=(select auth.uid())));
revoke all on public.catalogue_enrichment_jobs,public.collection_assessments,public.collection_assessment_jobs,public.collection_processing_attempts from public,anon,authenticated;
grant select on public.catalogue_enrichment_jobs,public.collection_assessments,public.collection_assessment_jobs,public.collection_processing_attempts to authenticated;
grant select,insert,update,delete on public.catalogue_enrichment_jobs,public.collection_assessments,public.collection_assessment_jobs,public.collection_processing_attempts to service_role;
grant usage,select on sequence public.collection_processing_attempts_id_seq to service_role;
revoke all on private.collection_taste_versions,private.collection_assessment_history from public,anon,authenticated,service_role;

create function private.collection_text(text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(lower(coalesce($1,'')),'[^[:alnum:]]+','','g') $$;
create function private.collection_content_version(w public.collection_catalogue_books) returns text language sql immutable set search_path='' as $$
 select md5(jsonb_build_array(w.title,w.authors,w.synopsis,w.publication_year,w.source_url,w.metadata_sources)::text) $$;
-- Timestamps, progress, confidence/evidence counters and cosmetic edits do not
-- invalidate every book. Qualitative evidence, ratings and substantive taste do.
create function private.collection_taste_context(u uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'profile',coalesce((select jsonb_agg(jsonb_build_object('id',id,'dimension',dimension,'preference',preference,'direction',direction,'strength',strength,'confidence',confidence,'notes',notes) order by id) from public.taste_profile where user_id=u),'[]'),
 'feedback',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'book_id',f.book_id,'title',b.title,'feedback',f.user_feedback,'aspect',f.aspect,'interpretation',f.preference_interpretation) order by f.id) from public.reading_feedback f join public.books b on b.id=f.book_id where f.user_id=u),'[]'),
 'history',coalesce((select jsonb_agg(jsonb_build_object('book_id',l.book_id,'title',b.title,'status',l.overall_status,'rating',l.user_rating_5,'review',l.user_review,'review_notes',l.review_notes) order by l.book_id) from public.library_entries l join public.books b on b.id=l.book_id where l.user_id=u),'[]'),
 'sessions',coalesce((select jsonb_agg(jsonb_build_object('book_id',s.book_id,'status',s.status,'rating',s.user_rating_5,'review',s.review,'review_notes',s.review_notes) order by s.id) from public.reading_sessions s where s.user_id=u),'[]'),
 'recommendations',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'book_id',r.book_id,'title',b.title,'reasoning',r.why_recommended,'score',r.match_score_10,'outcome',r.outcome,'learning',r.prediction_learning,'dismissal_reason',r.dismissal_reason,'status',r.recommendation_status,'active',r.is_active) order by r.id) from public.recommendations r join public.books b on b.id=r.book_id where r.user_id=u),'[]'),
 'taste_evidence',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.taste_evidence e join public.taste_profile p on p.id=e.taste_profile_id where p.user_id=u),'[]')) $$;
create function private.collection_taste_hash(c jsonb) returns text language sql immutable set search_path='' as $$
 select md5(jsonb_build_array(
 (select jsonb_agg(v order by v) from (select distinct jsonb_build_array(private.collection_text(e->>'dimension'),private.collection_text(e->>'preference'),e->'direction',e->'strength',private.collection_text(e->>'notes')) v from jsonb_array_elements(c->'profile') e) s),
 (select jsonb_agg(v order by v) from (select distinct jsonb_build_array(e->>'book_id',private.collection_text(e->>'feedback'),private.collection_text(e->>'aspect')) v from jsonb_array_elements(c->'feedback') e) s),
 (select jsonb_agg(jsonb_build_array(e->>'book_id',case when e->>'status' in ('Reading','Paused') then 'engaged' else e->>'status' end,e->'rating',private.collection_text(e->>'review'),private.collection_text(e->>'review_notes')) order by e->>'book_id') from jsonb_array_elements(c->'history') e where e->>'status' in ('Reading','Paused','Read','DNF') or e->>'rating' is not null or nullif(private.collection_text(e->>'review'),'') is not null or nullif(private.collection_text(e->>'review_notes'),'') is not null),
 (select jsonb_agg(v order by v) from (select distinct jsonb_build_array(e->>'book_id',case when e->>'status' in ('Reading','Paused') then 'engaged' else e->>'status' end,e->'rating',private.collection_text(e->>'review'),private.collection_text(e->>'review_notes')) v from jsonb_array_elements(c->'sessions') e where e->>'status' in ('Reading','Paused','Read','Finished','DNF') or e->>'rating' is not null or nullif(private.collection_text(e->>'review'),'') is not null or nullif(private.collection_text(e->>'review_notes'),'') is not null) s),
 (select jsonb_agg(jsonb_build_array(e->>'id',private.collection_text(e->>'reasoning'),private.collection_text(e->>'learning'),e->>'outcome',private.collection_text(e->>'dismissal_reason')) order by e->>'id') from jsonb_array_elements(c->'recommendations') e),
 (select jsonb_agg(jsonb_build_array(e->>'taste_profile_id',e->>'book_id',e->>'feedback_id',e->>'relation',private.collection_text(e->>'notes')) order by e->>'id') from jsonb_array_elements(c->'taste_evidence') e))::text) $$;

create function public.reconcile_collection_intelligence() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; h text; active text; cv text; n integer;
begin
 select owner_user_id into u from private.app_state where singleton;
 -- Reuse already persisted facts before scheduling any external lookup. The
 -- original canonical metadata source remains explicitly recorded as provenance.
 update public.collection_catalogue_books w set synopsis=coalesce(nullif(w.synopsis,''),nullif(b.synopsis,'')),
  publication_year=coalesce(w.publication_year,b.original_publication_year),
  cover_url=case when w.cover_locked then w.cover_url else coalesce(nullif(w.cover_url,''),b.cover_url_preferred) end,
  metadata_sources=w.metadata_sources||jsonb_build_array(jsonb_build_object('provider','Existing canonical metadata','book_id',b.id,'source_url',w.source_url,'canonical_metadata_source',b.metadata_source))
 from public.books b where b.id=w.book_id and ((nullif(w.synopsis,'') is null and nullif(b.synopsis,'') is not null)
  or (w.publication_year is null and b.original_publication_year is not null)
  or (not w.cover_locked and nullif(w.cover_url,'') is null and b.cover_url_preferred is not null));
 insert into public.catalogue_enrichment_jobs(work_key) select key from public.collection_catalogue_books on conflict do nothing;
 if u is null then return jsonb_build_object('owner',false); end if;
 h:=private.collection_taste_hash(private.collection_taste_context(u));
 insert into private.collection_taste_versions(user_id,version) values(u,h) on conflict do nothing;
 select version,candidate_version into active,cv from private.collection_taste_versions where user_id=u for update;
 if h<>active then
   if cv is distinct from h then update private.collection_taste_versions set candidate_version=h,candidate_since=now() where user_id=u;
   elsif exists(select 1 from private.collection_taste_versions where user_id=u and candidate_since<=now()-interval '6 hours') then
     update private.collection_taste_versions set version=h,candidate_version=null,candidate_since=null,activated_at=now() where user_id=u; active:=h;
   end if;
 else update private.collection_taste_versions set candidate_version=null,candidate_since=null where user_id=u and candidate_version is not null;
 end if;
 insert into public.collection_assessments(user_id,work_key) select u,key from public.collection_catalogue_books on conflict do nothing;
 insert into public.collection_assessment_jobs(user_id,work_key,taste_version,content_version)
 select u,key,active,private.collection_content_version(w) from public.collection_catalogue_books w
 on conflict(user_id,work_key) do update set status='queued',taste_version=excluded.taste_version,content_version=excluded.content_version,
  available_at=now(),claim_token=null,locked_at=null,attempt_count=0,last_error=null
 where collection_assessment_jobs.taste_version<>excluded.taste_version or collection_assessment_jobs.content_version<>excluded.content_version;
 get diagnostics n=row_count;
 return jsonb_build_object('queued',n,'taste_version',active,'change_settling',h<>active);
end $$;
revoke all on function public.reconcile_collection_intelligence() from public,anon,authenticated;
grant execute on function public.reconcile_collection_intelligence() to service_role;

create function private.queue_catalogue_intelligence() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.catalogue_enrichment_jobs(work_key) values(new.key) on conflict(work_key) do nothing;
 if tg_op='UPDATE' and (new.title,new.authors,new.book_id) is distinct from (old.title,old.authors,old.book_id) then
  update public.catalogue_enrichment_jobs set status='queued',available_at=now(),claim_token=null,locked_at=null,attempt_count=0 where work_key=new.key;
 end if;
 return new;
end $$;
revoke all on function private.queue_catalogue_intelligence() from public,anon,authenticated;
create trigger catalogue_intelligence_insert after insert or update of title,authors,book_id on public.collection_catalogue_books for each row execute function private.queue_catalogue_intelligence();

create function public.claim_catalogue_enrichment(p_limit integer default 2,p_work_key text default null) returns setof public.catalogue_enrichment_jobs language plpgsql security invoker set search_path='' as $$
begin
 insert into public.collection_processing_attempts(work_key,stage,claim_token,outcome,diagnostic)
 select work_key,'metadata',claim_token,'expired','{"reason":"Lease expired"}' from public.catalogue_enrichment_jobs where status='processing' and locked_at<now()-interval '15 minutes';
 update public.catalogue_enrichment_jobs set status='retry',claim_token=null,locked_at=null where status='processing' and locked_at<now()-interval '15 minutes';
 return query with due as(select j.work_key from public.catalogue_enrichment_jobs j where j.status in ('queued','retry','incomplete','failed') and j.available_at<=now()
  and (p_work_key is null or j.work_key=p_work_key) order by j.available_at,j.work_key limit greatest(1,least(4,p_limit)) for update skip locked)
 update public.catalogue_enrichment_jobs j set status='processing',claim_token=gen_random_uuid(),locked_at=now(),last_attempted_at=now(),attempt_count=case when j.attempt_count>=5 then 1 else j.attempt_count+1 end,
 identity_hash=(select md5(jsonb_build_array(w.title,w.authors,w.book_id)::text) from public.collection_catalogue_books w where w.key=j.work_key)
 from due where j.work_key=due.work_key returning j.*;
end $$;
create function public.finish_catalogue_enrichment(p_work_key text,p_token uuid,p_result jsonb,p_error text default null,p_retry_after timestamptz default null) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.catalogue_enrichment_jobs; w public.collection_catalogue_books; outcome text;
begin
 select * into j from public.catalogue_enrichment_jobs where work_key=p_work_key for update;
 if j.status<>'processing' or j.claim_token is distinct from p_token then return false;end if;
 select * into w from public.collection_catalogue_books where key=p_work_key for update;
 if j.identity_hash<>md5(jsonb_build_array(w.title,w.authors,w.book_id)::text) then return false;end if;
 if p_error is null then
  update public.collection_catalogue_books set synopsis=coalesce(nullif(synopsis,''),nullif(p_result->>'synopsis','')),
   publication_year=coalesce(publication_year,(p_result->>'publication_year')::integer),
   cover_url=case when cover_locked then cover_url else coalesce(nullif(cover_url,''),case when p_result->>'cover_verified'='true' then p_result->>'cover_url' end) end,
   cover_verified_at=case when p_result->>'cover_verified'='true' and coalesce(nullif(cover_url,''),p_result->>'cover_url')=p_result->>'cover_url' then now() else cover_verified_at end,
   metadata_sources=case when jsonb_typeof(p_result->'sources')='array' then (select coalesce(jsonb_agg(distinct e),'[]') from jsonb_array_elements(metadata_sources||(p_result->'sources')) e) else metadata_sources end
  where key=p_work_key;
 end if;
 select * into w from public.collection_catalogue_books where key=p_work_key;
 outcome:=case when p_error is not null then case when j.attempt_count>=5 then 'failed' else 'retry' end
  when nullif(w.synopsis,'') is not null and w.publication_year is not null and w.cover_verified_at is not null then 'complete' else 'incomplete' end;
 update public.collection_catalogue_books set enrichment_status=outcome,enrichment_last_attempted_at=now() where key=p_work_key;
 update public.catalogue_enrichment_jobs set status=outcome,claim_token=null,locked_at=null,last_error=left(p_error,1000),last_result=p_result,updated_at=now(),
  available_at=greatest(coalesce(p_retry_after,now()),now()+case when j.attempt_count>=5 or outcome='complete' then interval '30 days' else interval '6 hours'*power(2,j.attempt_count-1) end) where work_key=p_work_key;
 insert into public.collection_processing_attempts(work_key,stage,claim_token,outcome,diagnostic) values(p_work_key,'metadata',p_token,outcome,jsonb_build_object('error',left(p_error,1000),'result',p_result));
 return true;
end $$;
revoke all on function public.claim_catalogue_enrichment(integer,text),public.finish_catalogue_enrichment(text,uuid,jsonb,text,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_catalogue_enrichment(integer,text),public.finish_catalogue_enrichment(text,uuid,jsonb,text,timestamptz) to service_role;

-- Secure connector inference: these APIs are callable only as postgres through
-- the trusted connector, never using browser or service-role REST credentials.
create function public.collection_librarian_candidates(p_limit integer default 4) returns jsonb language plpgsql security invoker set search_path='' as $$
declare u uuid; c jsonb; candidates jsonb;
begin
 if current_user<>'postgres' then raise exception 'Trusted Librarian connector required' using errcode='42501';end if;
 perform public.reconcile_collection_intelligence();
 select owner_user_id into u from private.app_state where singleton;
 c:=private.collection_taste_context(u);
 -- Do not consume inference on a profile whose material update is still settling.
 if exists(select 1 from private.collection_taste_versions where user_id=u and candidate_version is not null) then return jsonb_build_object('candidates','[]'::jsonb,'status','taste_change_settling');end if;
 insert into public.collection_processing_attempts(work_key,user_id,stage,claim_token,outcome,diagnostic)
 select work_key,user_id,'assessment',claim_token,'expired','{"reason":"Librarian lease expired"}' from public.collection_assessment_jobs where status='processing' and locked_at<now()-interval '30 minutes';
 update public.collection_assessment_jobs set status='retry',claim_token=null,locked_at=null where status='processing' and locked_at<now()-interval '30 minutes';
 with due as(select work_key from public.collection_assessment_jobs where user_id=u and status in ('queued','retry','pending') and available_at<=now() order by available_at,work_key limit greatest(1,least(12,p_limit)) for update skip locked),
 claimed as(update public.collection_assessment_jobs j set status='processing',claim_token=gen_random_uuid(),locked_at=now(),last_attempted_at=now(),attempt_count=attempt_count+1 from due where j.user_id=u and j.work_key=due.work_key returning j.*)
 select coalesce(jsonb_agg(jsonb_build_object('job',to_jsonb(j),'work',to_jsonb(w),
  'collections',(select jsonb_agg(jsonb_build_object('name',co.name,'number',m.official_number,'source_url',co.source_url,'other_works',(select jsonb_agg(jsonb_build_object('title',w2.title,'number',m2.official_number,'book_id',w2.book_id) order by m2.official_number) from public.collection_memberships m2 join public.collection_catalogue_books w2 on w2.key=m2.work_key where m2.collection_key=co.key))) from public.collection_memberships m join public.collections co on co.key=m.collection_key where m.work_key=w.key),
  'previous_assessment',(select to_jsonb(a) from public.collection_assessments a where a.user_id=u and a.work_key=w.key))),'[]') into candidates from claimed j join public.collection_catalogue_books w on w.key=j.work_key;
 return jsonb_build_object('context',c,'candidates',candidates,'instructions','Assess individual characteristics from source evidence. Spoiler-free. Separate appeal, frustrations, verdict and continuity. Positive scores only. Pending if evidence is insufficient. Never change Library, recommendations, dismissals or paths.');
end $$;

create function public.publish_collection_assessment(p_work_key text,p_token uuid,p_taste_version text,p_assessment jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare u uuid; j public.collection_assessment_jobs; w public.collection_catalogue_books; v text; c jsonb;
begin
 if current_user<>'postgres' then raise exception 'Trusted Librarian connector required' using errcode='42501';end if;
 select owner_user_id into u from private.app_state where singleton;
 select * into j from public.collection_assessment_jobs where user_id=u and work_key=p_work_key for update;
 select * into w from public.collection_catalogue_books where key=p_work_key for share;
 c:=private.collection_taste_context(u);
 if j.status<>'processing' or j.claim_token is distinct from p_token or j.locked_at<now()-interval '30 minutes'
  or j.taste_version is distinct from p_taste_version or p_taste_version<>private.collection_taste_hash(c)
  or j.content_version is distinct from private.collection_content_version(w) then return false;end if;
 v:=p_assessment->>'verdict';
 if coalesce(v,'') not in ('recommended','optional','not_recommended','pending') then raise exception 'Invalid verdict';end if;
 if v<>'pending' then
  if jsonb_typeof(p_assessment->'evidence') is distinct from 'array' or jsonb_array_length(p_assessment->'evidence')=0
   or jsonb_typeof(p_assessment->'taste_evidence_ids') is distinct from 'array' or jsonb_array_length(p_assessment->'taste_evidence_ids')=0
   or length(coalesce(p_assessment->>'inference_provenance',''))<5 then raise exception 'Source, taste evidence and inference provenance required';end if;
  if exists(select 1 from jsonb_array_elements(p_assessment->'evidence') e where coalesce(e->>'source_url','') not like 'https://%' or length(coalesce(e->>'detail',''))<15) then raise exception 'Factual source evidence required';end if;
  if exists(select 1 from jsonb_array_elements_text(p_assessment->'taste_evidence_ids') eid where not exists(select 1 from public.taste_profile where user_id=u and id::text=eid) and not exists(select 1 from public.reading_feedback where user_id=u and id::text=eid)) then raise exception 'Foreign taste evidence' using errcode='42501';end if;
 elsif length(coalesce(p_assessment->>'pending_reason',''))<15 then raise exception 'Explain missing evidence';end if;
 -- A failed reassessment retains the previous result, with a visible pending note.
 insert into private.collection_assessment_history(user_id,work_key,assessment) select user_id,work_key,to_jsonb(a) from public.collection_assessments a where user_id=u and work_key=p_work_key and assessed_at is not null and v<>'pending';
 if v='pending' then
  update public.collection_assessments set pending_reason=p_assessment->>'pending_reason' where user_id=u and work_key=p_work_key;
 else
  update public.collection_assessments set verdict=v,appeal=p_assessment->>'appeal',frustrations=p_assessment->>'frustrations',reasoning=p_assessment->>'reasoning',continuity=p_assessment->>'continuity',
   match_score_10=case when v='recommended' then (p_assessment->>'match_score_10')::numeric else null end,confidence=p_assessment->>'confidence',
   evidence=p_assessment->'evidence',taste_evidence_ids=p_assessment->'taste_evidence_ids',taste_version=p_taste_version,content_version=j.content_version,
   assessed_at=now(),pending_reason='',inference_provenance=p_assessment->>'inference_provenance' where user_id=u and work_key=p_work_key;
 end if;
 update public.collection_assessment_jobs set status=case when v='pending' then 'pending' else 'complete' end,claim_token=null,locked_at=null,
  available_at=now()+case when attempt_count>=5 then interval '30 days' else interval '6 hours'*power(2,least(attempt_count-1,4)) end,last_error=case when v='pending' then p_assessment->>'pending_reason' end where user_id=u and work_key=p_work_key;
 insert into public.collection_processing_attempts(work_key,user_id,stage,claim_token,outcome,diagnostic) values(p_work_key,u,'assessment',p_token,v,jsonb_build_object('taste_version',p_taste_version,'content_version',j.content_version,'assessment',p_assessment));
 return true;
end $$;
revoke all on function public.collection_librarian_candidates(integer),public.publish_collection_assessment(text,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.collection_text(text),private.collection_content_version(public.collection_catalogue_books),private.collection_taste_context(uuid),private.collection_taste_hash(jsonb) from public,anon,authenticated,service_role;
select public.reconcile_collection_intelligence();
