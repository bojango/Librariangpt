-- Private editorial timeline. Source-table triggers capture changes from every writer.
create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null check (length(idempotency_key) between 1 and 240),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('wishlist','bought','started','finished','rating','paused','dnf','progress','quotes','librarian','taste','post')),
  source text not null default 'system' check (source in ('system','user','librarian','automation')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  book_id uuid references public.books(id) on delete cascade,
  quote_id uuid references public.book_quotes(id) on delete cascade,
  session_id uuid references public.reading_sessions(id) on delete set null,
  metadata jsonb not null default '{}' check (jsonb_typeof(metadata)='object'),
  content text check (length(content) <= 12000),
  hashtags text[] not null default '{}',
  unique(user_id,idempotency_key)
);
create index activity_owner_time_idx on public.activity_events(user_id,occurred_at desc,id desc);
create index activity_owner_category_time_idx on public.activity_events(user_id,event_type,occurred_at desc,id desc);
create index activity_book_idx on public.activity_events(book_id);
create index activity_quote_idx on public.activity_events(quote_id);
create index activity_session_idx on public.activity_events(session_id);
create index activity_hashtags_idx on public.activity_events using gin(hashtags);
alter table public.activity_events enable row level security;
create policy activity_owner_read on public.activity_events for select to authenticated
  using (private.is_owner() and user_id=(select auth.uid()));
-- Clients may author future posts, but cannot impersonate canonical source events.
create policy activity_owner_author on public.activity_events for insert to authenticated
  with check (private.is_owner() and user_id=(select auth.uid()) and event_type in ('librarian','post')
    and (book_id is null or exists(select 1 from public.library_entries l where l.book_id=activity_events.book_id and l.user_id=(select auth.uid())))
    and quote_id is null and session_id is null);
revoke all on public.activity_events from public,anon,authenticated;
grant select,insert on public.activity_events to authenticated;
grant all on public.activity_events to service_role;

-- Internal definer functions are trigger-only: no client execution or private-schema access added.
create function private.emit_activity(u uuid, kind text, book uuid, session uuid, meta jsonb,
  event_key text default null, happened timestamptz default now(), quote uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare change_key text := 'change:'||kind||':'||coalesce(book::text,'')||':'||pg_catalog.txid_current()::text;
  k text := coalesce(event_key,case when kind in ('started','finished') and session is not null
    then 'session:'||kind||':'||session::text else change_key end);
begin
  if u is null then return; end if;
  -- Reconcile a library mutation that preceded creation of its session in this transaction.
  if event_key is null and kind in ('started','finished') and session is not null then
    if exists(select 1 from public.activity_events where user_id=u and idempotency_key=k) then
      delete from public.activity_events where user_id=u and idempotency_key=change_key;
    else
      update public.activity_events set idempotency_key=k,session_id=session
        where user_id=u and idempotency_key=change_key;
    end if;
  end if;
  -- A finishing transaction often sets a rating in multiple source tables too.
  if kind='rating' and exists(select 1 from public.activity_events where user_id=u and book_id=book
    and (idempotency_key='change:finished:'||book::text||':'||pg_catalog.txid_current()::text
      or (session_id=session and created_at=now()))) then return; end if;
  if kind='finished' then
    delete from public.activity_events where user_id=u and book_id=book
      and idempotency_key='change:rating:'||book::text||':'||pg_catalog.txid_current()::text;
  end if;
  insert into public.activity_events(user_id,idempotency_key,event_type,book_id,session_id,quote_id,metadata,occurred_at,hashtags)
  values(u,k,kind,book,session,quote,meta,happened,array[case when kind in ('paused','dnf') then 'progress' when kind='taste' then 'librarian' else kind end])
  on conflict(user_id,idempotency_key) do update set
    session_id=coalesce(excluded.session_id,activity_events.session_id),
    metadata=activity_events.metadata||case when kind='quotes' then excluded.metadata else jsonb_strip_nulls(excluded.metadata) end;
end $$;
revoke all on function private.emit_activity(uuid,text,uuid,uuid,jsonb,text,timestamptz,uuid) from public,anon,authenticated;

create function private.capture_reading_activity() returns trigger
language plpgsql security definer set search_path='' as $$
declare j jsonb:=to_jsonb(new); prev jsonb:='{}'; kind text; s uuid; meta jsonb;
  old_status text; status text; old_percent numeric; percent numeric; milestone integer;
begin
  if tg_op='UPDATE' then prev:=to_jsonb(old); end if;
  if tg_table_name='book_quotes' then
    perform private.emit_activity(new.user_id,'quotes',new.book_id,new.session_id,
      jsonb_build_object('quote_text',new.quote_text,'note',new.note,'page_start',new.page_start,'page_end',new.page_end,'chapter',new.chapter),
      'quote:'||new.id::text,new.created_at,new.id);
    return new;
  elsif tg_table_name='taste_profile' then
    -- Counts, dates and enrichment alone are not preference discoveries.
    if new.evidence_count>=2 and new.confidence<>'Low' and (tg_op='INSERT' or
      (prev->>'preference',prev->>'direction',prev->>'strength',prev->>'confidence') is distinct from
      (new.preference,new.direction,new.strength,new.confidence)) then
      perform private.emit_activity(new.user_id,'taste',null,null,
        jsonb_build_object('dimension',new.dimension,'preference',new.preference,'direction',new.direction,'confidence',new.confidence),
        'taste:'||new.id::text||':'||pg_catalog.txid_current()::text);
    end if;
    return new;
  end if;
  if tg_table_name='reading_sessions' then
    s:=new.id; status:=new.status; old_status:=prev->>'status';
  else
    status:=new.overall_status; old_status:=prev->>'overall_status';
    select rs.id into s from public.reading_sessions rs where rs.user_id=new.user_id and rs.book_id=new.book_id
      and (case new.overall_status when 'Currently Reading' then rs.status='Reading' when 'Read' then rs.status='Completed' else true end)
      order by rs.created_at desc,rs.id desc limit 1;
  end if;
  meta:=jsonb_build_object('rating',j->'user_rating_5','page',j->'current_page');
  if status is distinct from old_status then
    kind:=case status when 'Wishlist' then 'wishlist' when 'Currently Reading' then 'started'
      when 'Reading' then 'started' when 'Read' then 'finished' when 'Completed' then 'finished'
      when 'Paused' then 'paused' when 'DNF' then 'dnf' end;
    if kind is not null then
      perform private.emit_activity(new.user_id,kind,new.book_id,s,meta,null,
        case kind when 'started' then coalesce((j->>'started_at')::timestamptz,now())
          when 'finished' then coalesce((j->>'completed_at')::timestamptz,now()) else now() end);
    end if;
  end if;
  if tg_table_name='library_entries' and j->>'ownership_status' in ('Owned','On Order') and
    j->>'ownership_status' is distinct from prev->>'ownership_status' then
    perform private.emit_activity(new.user_id,'bought',new.book_id,null,
      jsonb_build_object('ownership_status',j->>'ownership_status'));
  end if;
  if tg_op='UPDATE' and j->'user_rating_5' is distinct from prev->'user_rating_5' and
    kind is distinct from 'finished' then
    perform private.emit_activity(new.user_id,'rating',new.book_id,s,meta||jsonb_build_object('previous_rating',prev->'user_rating_5'));
    -- Keep the original completion card's rating current when a review is added later.
    update public.activity_events set metadata=metadata||jsonb_build_object('rating',j->'user_rating_5')
      where user_id=new.user_id and event_type='finished' and
      ((s is not null and session_id=s) or (s is null and book_id=new.book_id));
  end if;
  -- Session milestones once per 25/50/75 percent; never one post per page.
  -- Library progress is only a fallback where no canonical session exists.
  if tg_op='UPDATE' and status in ('Reading','Currently Reading') and
    j->'current_page' is distinct from prev->'current_page' and
    j->'total_pages' is not distinct from prev->'total_pages' and
    (tg_table_name='reading_sessions' or s is null) and (j->>'total_pages')::numeric>0 then
    old_percent:=coalesce((prev->>'current_page')::numeric,0)/(j->>'total_pages')::numeric*100;
    percent:=(j->>'current_page')::numeric/(j->>'total_pages')::numeric*100;
    milestone:=least(75,(floor(percent/25)*25)::integer);
    if milestone>=25 and old_percent<milestone then
      perform private.emit_activity(new.user_id,'progress',new.book_id,s,meta||jsonb_build_object('percent',milestone),
        'milestone:'||coalesce(s::text,'entry:'||new.id::text)||':'||milestone::text);
    end if;
  end if;
  return new;
end $$;
revoke all on function private.capture_reading_activity() from public,anon,authenticated;
create trigger activity_capture after insert or update on public.library_entries for each row execute function private.capture_reading_activity();
create trigger activity_capture after insert or update on public.reading_sessions for each row execute function private.capture_reading_activity();
create trigger activity_capture after insert or update on public.book_quotes for each row execute function private.capture_reading_activity();
create trigger activity_capture after insert or update on public.taste_profile for each row execute function private.capture_reading_activity();

-- Secure authoring API. JWT identity is mandatory; callers cannot choose another owner.
create function public.add_librarian_entry(p_source text,p_content text,p_idempotency_key text,
  p_book_id uuid default null,p_tags text[] default '{}') returns uuid
language plpgsql security invoker set search_path='' as $$
declare result uuid; u uuid:=(select auth.uid());
begin
  if u is null or not private.is_owner() then raise exception 'Not authorized' using errcode='42501'; end if;
  if p_source not in ('user','librarian','automation','system') or p_source is null then raise exception 'Invalid source'; end if;
  if nullif(btrim(p_content),'') is null or length(p_content)>12000 then raise exception 'Content required (maximum 12000 characters)'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>220 then raise exception 'Idempotency key required'; end if;
  if cardinality(p_tags)>20 then raise exception 'Too many tags'; end if;
  if exists(select 1 from unnest(p_tags) tag where tag !~ '^[a-z0-9_]+$' or length(tag)>40) then raise exception 'Invalid hashtag'; end if;
  insert into public.activity_events(user_id,idempotency_key,event_type,source,content,book_id,hashtags)
    values(u,'librarian:'||p_idempotency_key,'librarian',p_source,p_content,p_book_id,array['librarian']||coalesce(p_tags,'{}'))
    on conflict(user_id,idempotency_key) do nothing returning id into result;
  if result is null then select id into result from public.activity_events where user_id=u and idempotency_key='librarian:'||p_idempotency_key; end if;
  return result;
end $$;
revoke all on function public.add_librarian_entry(text,text,text,uuid,text[]) from public,anon;
grant execute on function public.add_librarian_entry(text,text,text,uuid,text[]) to authenticated;

-- Explicit, repeatable backfill: only session dates, saved quotes and logged events.
-- No inferred purchase/wishlist dates from a book's current status or updated_at.
create function private.backfill_activity() returns void language plpgsql security definer set search_path='' as $$
declare r record;
begin
  for r in select * from public.reading_sessions loop
    if r.started_at is not null and r.status<>'Planned' and not exists
      (select 1 from public.activity_events where session_id=r.id and event_type='started') then
      perform private.emit_activity(r.user_id,'started',r.book_id,r.id,'{}','session:started:'||r.id::text,r.started_at);
    end if;
    if r.status='Completed' and r.completed_at is not null and not exists
      (select 1 from public.activity_events where session_id=r.id and event_type='finished') then
      perform private.emit_activity(r.user_id,'finished',r.book_id,r.id,jsonb_build_object('rating',r.user_rating_5),
        'session:finished:'||r.id::text,r.completed_at);
    end if;
  end loop;
  for r in select * from public.book_quotes loop
    perform private.emit_activity(r.user_id,'quotes',r.book_id,r.session_id,
      jsonb_build_object('quote_text',r.quote_text,'note',r.note,'page_start',r.page_start,'page_end',r.page_end,'chapter',r.chapter),
      'quote:'||r.id::text,r.created_at,r.id);
  end loop;
  for r in select l.* from public.library_entries l where not exists
    (select 1 from public.reading_sessions rs where rs.user_id=l.user_id and rs.book_id=l.book_id) loop
    if r.started_at is not null then
      perform private.emit_activity(r.user_id,'started',r.book_id,null,'{}','history:entry:started:'||r.id::text,r.started_at);
    end if;
    if r.overall_status='Read' and r.completed_at is not null then
      perform private.emit_activity(r.user_id,'finished',r.book_id,null,jsonb_build_object('rating',r.user_rating_5),
        'history:entry:finished:'||r.id::text,r.completed_at);
    end if;
  end loop;
  for r in select * from public.library_events where book_id is not null and event_type in ('wishlist_added','wishlist_added_from_recommendation','purchase_ordered') order by id loop
    if exists(select 1 from public.activity_events where user_id=r.user_id and book_id=r.book_id and occurred_at=r.occurred_at
      and event_type=case when r.event_type='purchase_ordered' then 'bought' else 'wishlist' end) then continue; end if;
    perform private.emit_activity(r.user_id,case when r.event_type='purchase_ordered' then 'bought' else 'wishlist' end,r.book_id,null,
      r.payload,'history:event:'||r.id::text,r.occurred_at);
  end loop;
end $$;
revoke all on function private.backfill_activity() from public,anon,authenticated;
select private.backfill_activity();
