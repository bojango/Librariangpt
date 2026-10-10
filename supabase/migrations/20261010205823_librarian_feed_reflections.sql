-- Management SQL connector only. No browser RPC or service credential is added.
create function private.librarian_feedback_key(p_text text) returns text
language sql immutable security invoker set search_path='' as $$
  select md5(lower(btrim(regexp_replace(p_text,'[[:space:][:punct:]]+',' ','g'))));
$$;
create function private.librarian_qualitative_feedback(p_text text) returns boolean
language sql immutable security invoker set search_path='' as $$
  select length(btrim(p_text))>=24 and cardinality(regexp_split_to_array(btrim(p_text),'[[:space:]]+'))>=5
    and p_text ~ '[[:alpha:]]' and p_text !~* '^\s*(rating|rated|progress|page|pages)\s*[:0-9]';
$$;
create function private.librarian_feedback_json(f public.reading_feedback) returns jsonb
language sql stable security invoker set search_path='' as $$
  select to_jsonb(f)-'user_id'-'legacy_id'-'notes'||jsonb_build_object('evidence_key',private.librarian_feedback_key(f.user_feedback));
$$;

create table private.librarian_feed_receipts (
  candidate_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  session_id uuid references public.reading_sessions(id) on delete set null,
  event_id uuid not null unique references public.activity_events(id) on delete cascade,
  observation_key text not null check(length(observation_key) between 8 and 160),
  content_key text not null,
  request_key text not null,
  reason text not null,
  published_at timestamptz not null default now(),
  unique(user_id,book_id,observation_key),
  unique(user_id,book_id,content_key)
);
create index librarian_receipt_session_idx on private.librarian_feed_receipts(session_id);
create index librarian_receipt_owner_time_idx on private.librarian_feed_receipts(user_id,book_id,published_at desc);

-- Evidence snapshots are an audit trail, not a second feed or mutable feedback store.
create table private.librarian_feed_evidence (
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  evidence_key text not null,
  feedback_id uuid references public.reading_feedback(id) on delete set null,
  candidate_id text references private.librarian_feed_receipts(candidate_id) on delete cascade,
  disposition text not null check(disposition in ('baseline','published')),
  evidence jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key(user_id,book_id,evidence_key),
  check((disposition='baseline' and candidate_id is null) or (disposition='published' and candidate_id is not null))
);
create index librarian_evidence_feedback_idx on private.librarian_feed_evidence(feedback_id);
create index librarian_evidence_receipt_idx on private.librarian_feed_evidence(candidate_id);

create table private.librarian_feed_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  candidate_id text not null,
  result text not null check(result in ('published','retry','duplicate_observation')),
  event_id uuid references public.activity_events(id) on delete set null,
  recorded_at timestamptz not null default now()
);
create index librarian_audit_owner_time_idx on private.librarian_feed_audit(user_id,recorded_at desc);
create index librarian_audit_event_idx on private.librarian_feed_audit(event_id);
alter table private.librarian_feed_receipts enable row level security;
alter table private.librarian_feed_evidence enable row level security;
alter table private.librarian_feed_audit enable row level security;
create policy management_only on private.librarian_feed_receipts to postgres using(true) with check(true);
create policy management_only on private.librarian_feed_evidence to postgres using(true) with check(true);
create policy management_only on private.librarian_feed_audit to postgres using(true) with check(true);
revoke all on private.librarian_feed_receipts,private.librarian_feed_evidence,private.librarian_feed_audit from public,anon,authenticated,service_role;
revoke all on sequence private.librarian_feed_audit_id_seq from public,anon,authenticated,service_role;

create index librarian_feedback_owner_book_time_idx on public.reading_feedback(user_id,book_id,created_at desc,id);
-- Existing taste_evidence_feedback_idx already indexes the feedback join.
create index librarian_activity_book_time_idx on public.activity_events(user_id,book_id,occurred_at desc) where event_type='librarian';

-- Existing observations become comparison context. Activation never publishes old history.
insert into private.librarian_feed_evidence(user_id,book_id,evidence_key,feedback_id,disposition,evidence)
select f.user_id,f.book_id,private.librarian_feedback_key(f.user_feedback),f.id,'baseline',private.librarian_feedback_json(f)
from public.reading_feedback f where f.user_id is not null and lower(coalesce(f.added_by,''))<>'test'
on conflict(user_id,book_id,evidence_key) do nothing;

create function private.librarian_feed_candidate(p_book uuid,p_session uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare u uuid; l public.library_entries; s public.reading_sessions; f public.reading_feedback;
  new_evidence jsonb:='[]'; previous jsonb; prior jsonb; changes jsonb:='[]'; taste jsonb; recent jsonb;
  reasons text[]:='{}'; supported text[]; day_posts integer; k text; cid text;
begin
  select owner_user_id into u from private.app_state where singleton;
  select * into l from public.library_entries where user_id=u and book_id=p_book;
  if not found then return null;end if;
  if p_session is not null then
    select * into s from public.reading_sessions where id=p_session and user_id=u and book_id=p_book;
    if not found then return null;end if;
  else
    select * into s from public.reading_sessions where user_id=u and book_id=p_book
      order by (status='Reading') desc,started_at desc nulls last,created_at desc,id desc limit 1;
  end if;
  for f in select d.* from (select distinct on (private.librarian_feedback_key(rf.user_feedback)) rf.* from public.reading_feedback rf
    where rf.user_id=u and rf.book_id=p_book and rf.session_id is not distinct from p_session
      and private.librarian_qualitative_feedback(rf.user_feedback)
      and lower(coalesce(rf.added_by,'')) not in ('test','import','migration')
      and not exists(select 1 from private.librarian_feed_evidence e where e.user_id=u and e.book_id=p_book
        and e.evidence_key=private.librarian_feedback_key(rf.user_feedback))
    order by private.librarian_feedback_key(rf.user_feedback),rf.created_at,rf.id) d order by d.created_at,d.id limit 12 loop
    supported:=array['reading_reaction'];
    -- Compare the latest related observation, not unrelated positive/negative aspects.
    select x.evidence into prior from (
      select private.librarian_feedback_json(p) evidence,p.updated_at recorded_at from public.reading_feedback p
        where p.user_id=u and p.book_id=p_book and p.session_id is not distinct from p_session
          and p.created_at<f.created_at and private.librarian_qualitative_feedback(p.user_feedback)
          and lower(coalesce(p.added_by,''))<>'test'
      union all
      select e.evidence,e.recorded_at from private.librarian_feed_evidence e
        where e.user_id=u and e.book_id=p_book and (e.evidence->>'session_id')::uuid is not distinct from p_session
          and (e.feedback_id=f.id or (e.evidence->>'created_at')::timestamptz<f.created_at)
    ) x where x.evidence->>'evidence_key'<>private.librarian_feedback_key(f.user_feedback)
      and lower(btrim(split_part(x.evidence->>'aspect','/',1)))=lower(btrim(split_part(f.aspect,'/',1)))
      and nullif(btrim(f.aspect),'') is not null
    order by (x.evidence->>'created_at')::timestamptz desc,x.recorded_at desc limit 1;
    if f.confidence in ('Medium','High') and prior->>'confidence' in ('Medium','High')
      and ((f.sentiment='Positive' and prior->>'sentiment'='Negative') or (f.sentiment='Negative' and prior->>'sentiment'='Positive')) then
      changes:=changes||jsonb_build_array(jsonb_build_object('new_feedback_id',f.id,'previous_feedback',prior));
      supported:=supported||array['changing_opinion'];
    end if;
    if f.reading_stage in ('Finished','Post-read') and (s.status='Completed' or (p_session is null and l.overall_status='Read')) then
      supported:=supported||array['completed_review'];
    end if;
    if f.confidence='High' and f.evidence_strength='Strong' and length(f.user_feedback)>=120
      and nullif(btrim(f.aspect),'') is not null and exists(select 1 from public.activity_events a where a.user_id=u and a.book_id=p_book and a.event_type='librarian')
      and not exists(select 1 from public.reading_feedback p where p.user_id=u and p.book_id=p_book and p.id<>f.id
        and p.created_at<f.created_at and lower(btrim(split_part(p.aspect,'/',1)))=lower(btrim(split_part(f.aspect,'/',1))))
      and not exists(select 1 from private.librarian_feed_evidence e where e.user_id=u and e.book_id=p_book
        and lower(btrim(split_part(e.evidence->>'aspect','/',1)))=lower(btrim(split_part(f.aspect,'/',1)))) then
      supported:=supported||array['significant_feedback'];
    end if;
    if f.generalisable and exists(select 1 from public.taste_evidence te join public.taste_profile tp on tp.id=te.taste_profile_id
      where te.feedback_id=f.id and tp.user_id=u and tp.evidence_count>=2 and tp.confidence in ('Medium','High')) then
      supported:=supported||array['taste_discovery'];
    end if;
    if s.status='Reading' and s.total_pages>0 and 100.0*s.current_page/s.total_pages between 45 and 60 then supported:=supported||array['reading_milestone'];end if;
    new_evidence:=new_evidence||jsonb_build_array(private.librarian_feedback_json(f)||jsonb_build_object('supported_reasons',supported));
  end loop;
  if jsonb_array_length(new_evidence)=0 then return null;end if;
  -- Europe/London is the library's editorial day; timestamps remain timestamptz.
  select count(*) into day_posts from public.activity_events where user_id=u and book_id=p_book and event_type='librarian'
    and occurred_at>=date_trunc('day',now() at time zone 'Europe/London') at time zone 'Europe/London';
  if day_posts>=3 then return null;end if;
  if day_posts=0 then
    select array_agg(distinct v) into reasons from jsonb_array_elements(new_evidence) e,
      jsonb_array_elements_text(e->'supported_reasons') v where v in ('reading_reaction','reading_milestone','taste_discovery');
  end if;
  foreach k in array array['changing_opinion','completed_review','significant_feedback'] loop
    if exists(select 1 from jsonb_array_elements(new_evidence) e where (e->'supported_reasons') ? k)
      and not exists(select 1 from public.activity_events a where a.user_id=u and a.book_id=p_book and a.event_type='librarian'
        and a.metadata->>'editorial_reason'=k
        and a.occurred_at>=date_trunc('day',now() at time zone 'Europe/London') at time zone 'Europe/London') then reasons:=reasons||k;end if;
  end loop;
  if cardinality(reasons)=0 then return null;end if;
  select jsonb_agg(x.evidence order by x.recorded_at desc) into previous from (select y.* from (
    select distinct on (evidence->>'evidence_key') evidence,recorded_at from (
      select private.librarian_feedback_json(p) evidence,p.updated_at recorded_at from public.reading_feedback p where p.user_id=u and p.book_id=p_book
        and private.librarian_qualitative_feedback(p.user_feedback) and lower(coalesce(p.added_by,''))<>'test'
      union all select e.evidence,e.recorded_at from private.librarian_feed_evidence e where e.user_id=u and e.book_id=p_book
    ) h where private.librarian_qualitative_feedback(h.evidence->>'user_feedback')
      and not exists(select 1 from jsonb_array_elements(new_evidence) ne where ne->>'evidence_key'=h.evidence->>'evidence_key')
    order by evidence->>'evidence_key',recorded_at desc
  ) y order by y.recorded_at desc limit 24
  ) x;
  -- Context includes genuine recorded taste links, not guessed genres or model preferences.
  select jsonb_agg(x.j) into taste from (
    select jsonb_build_object('id',tp.id,'dimension',tp.dimension,'preference',tp.preference,'direction',tp.direction,
      'confidence',tp.confidence,'evidence_count',tp.evidence_count,'last_updated',tp.last_updated,'updated_at',tp.updated_at,
      'feedback_id',te.feedback_id,'relation',te.relation,'weight',te.weight) j
    from public.taste_evidence te join public.taste_profile tp on tp.id=te.taste_profile_id
    where tp.user_id=u and (te.book_id=p_book or exists(select 1 from public.reading_feedback rf where rf.id=te.feedback_id and rf.user_id=u and rf.book_id=p_book))
      and (te.feedback_id is null or exists(select 1 from public.reading_feedback rf where rf.id=te.feedback_id and rf.user_id=u))
    order by tp.updated_at desc limit 20
  ) x;
  select jsonb_agg(x.j) into recent from (
    select jsonb_build_object('id',id,'content',content,'occurred_at',occurred_at,'metadata',metadata) j
    from public.activity_events where user_id=u and book_id=p_book and event_type='librarian' order by occurred_at desc,id desc limit 8
  ) x;
  cid:='lf1:'||p_book::text||':'||coalesce(p_session::text,'none')||':'||md5(u::text||
    (select string_agg((ne->>'id')||':'||(ne->>'evidence_key'),',' order by ne->>'id') from jsonb_array_elements(new_evidence) ne));
  return jsonb_build_object('candidate_id',cid,'book_id',p_book,'book',(select jsonb_build_object('title',title,'authors',(select jsonb_agg(a.name order by ba.author_order) from public.book_authors ba join public.authors a on a.id=ba.author_id where ba.book_id=p_book)) from public.books where id=p_book),
    'reader',(select coalesce(nullif(display_name,''),nullif(handle,''),'Reader') from public.reader_profiles where user_id=u),
    'session_id',p_session,'reading_context',jsonb_build_object('session',to_jsonb(s)-'user_id','library_status',l.overall_status,
      'page',coalesce(s.current_page,l.current_page),'total_pages',coalesce(s.total_pages,l.total_pages)),
    'new_feedback',new_evidence,'previous_feedback',coalesce(previous,'[]'),'change_evidence',changes,
    'taste_context',coalesce(taste,'[]'),'recent_reflections',coalesce(recent,'[]'),'most_recent_reflection',recent->0,
    'published_observation_keys',(select coalesce(jsonb_agg(observation_key order by published_at desc),'[]') from private.librarian_feed_receipts where user_id=u and book_id=p_book),
    'recommendation_context',(select jsonb_build_object('why_recommended',why_recommended,'outcome',outcome,'prediction_learning',prediction_learning)
      from public.recommendations where user_id=u and book_id=p_book order by updated_at desc limit 1),
    'automatic_taste_events',(select coalesce(jsonb_agg(x.j),'[]') from (
      select jsonb_build_object('id',a.id,'metadata',a.metadata,'occurred_at',a.occurred_at) j from public.activity_events a
      where a.user_id=u and a.event_type='taste' order by occurred_at desc limit 5) x),
    'eligible_reasons',reasons,'reason','New qualitative feedback not used in a published reflection; review evidence and prefer silence over repetition',
    'posts_today',day_posts);
end $$;

create function public.librarian_feed_candidates(p_limit integer default 5) returns setof jsonb
language plpgsql stable security invoker set search_path='' as $$
declare scope record;c jsonb;n integer:=0;
begin
  if current_user<>'postgres' then raise exception 'Management SQL connection required' using errcode='42501';end if;
  if p_limit is null or p_limit not between 1 and 20 then raise exception 'Limit must be between 1 and 20';end if;
  for scope in select f.book_id,f.session_id,max(f.created_at) newest from public.reading_feedback f
    where f.user_id=(select owner_user_id from private.app_state where singleton)
      and private.librarian_qualitative_feedback(f.user_feedback)
      and not exists(select 1 from private.librarian_feed_evidence e where e.user_id=f.user_id and e.book_id=f.book_id
        and e.evidence_key=private.librarian_feedback_key(f.user_feedback))
    group by f.book_id,f.session_id order by newest desc,f.book_id,f.session_id loop
    c:=private.librarian_feed_candidate(scope.book_id,scope.session_id);
    if c is not null then return next c;n:=n+1;if n>=p_limit then exit;end if;end if;
  end loop;
end $$;

create function public.publish_librarian_feed_reflection(p_candidate_id text,p_content text,p_feedback_ids uuid[],
  p_observation_key text,p_reason text default 'reading_reaction',p_comparison_feedback_ids uuid[] default '{}') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u uuid;b uuid;s uuid;c jsonb;item jsonb;selected jsonb:='[]';comparison jsonb:='[]';r private.librarian_feed_receipts;
  req text;eid uuid;tags text[]:=array['librarian','reflections'];
begin
  if current_user<>'postgres' then raise exception 'Management SQL connection required' using errcode='42501';end if;
  select owner_user_id into u from private.app_state where singleton;
  if u is null then raise exception 'Library owner not configured';end if;
  if p_candidate_id is null or p_candidate_id !~ '^lf1:[0-9a-f-]{36}:(none|[0-9a-f-]{36}):[0-9a-f]{32}$' then raise exception 'Invalid candidate identifier';end if;
  if nullif(btrim(p_content),'') is null or length(p_content) not between 40 and 1200 then raise exception 'Reflection must contain 40–1200 characters';end if;
  if p_observation_key is null or length(p_observation_key) not between 8 and 160 or p_observation_key !~ '^[a-z0-9][a-z0-9:_-]+$' then raise exception 'Invalid stable observation key';end if;
  if cardinality(p_feedback_ids) not between 1 and 12 or p_feedback_ids is null or array_position(p_feedback_ids,null) is not null
    or cardinality(p_feedback_ids)<>(select count(distinct v) from unnest(p_feedback_ids) v) then raise exception 'Provide 1–12 distinct feedback identifiers';end if;
  if p_comparison_feedback_ids is null or cardinality(p_comparison_feedback_ids)>12 or array_position(p_comparison_feedback_ids,null) is not null then raise exception 'Invalid comparison evidence';end if;
  b:=split_part(p_candidate_id,':',2)::uuid;s:=nullif(split_part(p_candidate_id,':',3),'none')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(u::text||b::text,7319));
  req:=md5(jsonb_build_object('content',p_content,'feedback',(select jsonb_agg(v order by v) from unnest(p_feedback_ids) v),
    'observation',p_observation_key,'reason',p_reason,'comparisons',(select coalesce(jsonb_agg(v order by v),'[]') from unnest(p_comparison_feedback_ids) v))::text);
  select * into r from private.librarian_feed_receipts where candidate_id=p_candidate_id and user_id=u;
  if found then
    if r.request_key<>req then raise exception 'Candidate already published with a different request';end if;
    insert into private.librarian_feed_audit(user_id,candidate_id,result,event_id) values(u,p_candidate_id,'retry',r.event_id);
    return jsonb_build_object('status','already_published','event_id',r.event_id,'candidate_id',p_candidate_id);
  end if;
  perform 1 from public.library_entries where user_id=u and book_id=b for share;
  if not found then raise exception 'Book is not in owner library' using errcode='42501';end if;
  perform 1 from public.reading_feedback where user_id=u and book_id=b and id=any(p_feedback_ids||p_comparison_feedback_ids) order by id for share;
  c:=private.librarian_feed_candidate(b,s);
  if c is null or c->>'candidate_id'<>p_candidate_id then raise exception 'Candidate is stale, processed or not eligible; rediscover';end if;
  if p_reason is null or not (c->'eligible_reasons') ? p_reason then raise exception 'Reason is not eligible (frequency or evidence)';end if;
  for item in select value from jsonb_array_elements(c->'new_feedback') loop
    if (item->>'id')::uuid=any(p_feedback_ids) then selected:=selected||jsonb_build_array(item);end if;
  end loop;
  if jsonb_array_length(selected)<>cardinality(p_feedback_ids) then raise exception 'Feedback does not belong to this candidate' using errcode='42501';end if;
  if not exists(select 1 from jsonb_array_elements(selected) e where (e->'supported_reasons') ? p_reason) then raise exception 'Selected evidence does not support reason';end if;
  if exists(select 1 from unnest(p_comparison_feedback_ids) ci(feedback_uuid)
    where not exists(select 1 from public.reading_feedback f where f.id=ci.feedback_uuid and f.user_id=u and f.book_id=b)) then
    raise exception 'Unrelated comparison evidence' using errcode='42501';end if;
  if p_reason='changing_opinion' then
    select coalesce(jsonb_agg(e->'previous_feedback'),'[]') into comparison from jsonb_array_elements(c->'change_evidence') e
      where (e->>'new_feedback_id')::uuid=any(p_feedback_ids) and (e->'previous_feedback'->>'id')::uuid=any(p_comparison_feedback_ids);
    if jsonb_array_length(comparison)=0 then raise exception 'Changing opinion requires the recorded opposing comparison';end if;
  else
    select coalesce(jsonb_agg(private.librarian_feedback_json(f)),'[]') into comparison from public.reading_feedback f where f.id=any(p_comparison_feedback_ids);
  end if;
  -- A rephrased observation can reuse the same stable key; exact prose is independently protected.
  select id into eid from public.activity_events where user_id=u and (book_id=b or (event_type='taste' and book_id is null)) and event_type in ('librarian','taste')
    and (private.librarian_feedback_key(content)=private.librarian_feedback_key(p_content)
      or (event_type='taste' and private.librarian_feedback_key(metadata->>'preference')=private.librarian_feedback_key(p_content))) limit 1;
  if eid is null then select event_id into eid from private.librarian_feed_receipts where user_id=u and book_id=b and observation_key=p_observation_key;end if;
  if eid is not null then
    insert into private.librarian_feed_audit(user_id,candidate_id,result,event_id) values(u,p_candidate_id,'duplicate_observation',eid);
    return jsonb_build_object('status','duplicate_observation','event_id',eid,'candidate_id',p_candidate_id);
  end if;
  tags:=tags||case p_reason when 'completed_review' then 'review' when 'taste_discovery' then 'taste' when 'reading_milestone' then 'milestones' else 'reactions' end;
  insert into public.activity_events(user_id,idempotency_key,event_type,source,content,book_id,session_id,hashtags,metadata)
    values(u,'librarian-feed:'||p_candidate_id,'librarian','automation',btrim(p_content),b,s,tags,
      jsonb_build_object('pipeline','librarian-feed-v1','candidate_id',p_candidate_id,'editorial_reason',p_reason,'observation_key',p_observation_key,
        'feedback_ids',p_feedback_ids,'evidence',selected,'comparison_evidence',comparison)) returning id into eid;
  insert into private.librarian_feed_receipts(candidate_id,user_id,book_id,session_id,event_id,observation_key,content_key,request_key,reason)
    values(p_candidate_id,u,b,s,eid,p_observation_key,private.librarian_feedback_key(p_content),req,p_reason);
  insert into private.librarian_feed_evidence(user_id,book_id,evidence_key,feedback_id,candidate_id,disposition,evidence)
    select u,b,e->>'evidence_key',(e->>'id')::uuid,p_candidate_id,'published',e from jsonb_array_elements(selected) e;
  insert into private.librarian_feed_audit(user_id,candidate_id,result,event_id) values(u,p_candidate_id,'published',eid);
  return jsonb_build_object('status','published','event_id',eid,'candidate_id',p_candidate_id);
end $$;

revoke all on function private.librarian_feedback_key(text),private.librarian_qualitative_feedback(text),private.librarian_feedback_json(public.reading_feedback),
  private.librarian_feed_candidate(uuid,uuid),public.librarian_feed_candidates(integer),
  public.publish_librarian_feed_reflection(text,text,uuid[],text,text,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.librarian_feed_candidates(integer),public.publish_librarian_feed_reflection(text,text,uuid[],text,text,uuid[]) to postgres;
