-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- SECURITY REDACTION: the original one-time claim code and personal source label
-- were intentionally replaced below. This historical migration is not replayable
-- without supplying a new deployment-specific bootstrap value through a reviewed path.
-- Preserve ordering and review against a development branch before applying anywhere.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.app_state (
  singleton boolean primary key default true check (singleton),
  owner_user_id uuid references auth.users(id) on delete set null,
  claim_code_hash text,
  source_system text not null default 'google_sheets',
  source_reference text,
  schema_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into private.app_state(singleton, claim_code_hash, source_reference)
values (true, encode(extensions.digest('REDACTED_DEPLOYMENT_CLAIM_CODE','sha256'),'hex'), 'REDACTED_SOURCE_REFERENCE')
on conflict (singleton) do nothing;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select owner_user_id = (select auth.uid()) from private.app_state where singleton = true), false);
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.books (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  title text not null,
  subtitle text,
  original_publication_year integer check (original_publication_year between 0 and 3000),
  fiction_nonfiction text check (fiction_nonfiction in ('Fiction','Nonfiction')),
  primary_genre text,
  themes_tags text[] not null default '{}',
  language text,
  synopsis text,
  cover_url_preferred text,
  cover_source text,
  cover_verified boolean,
  metadata_source text,
  metadata_last_updated date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.authors (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.book_authors (
  book_id uuid not null references public.books(id) on delete cascade,
  author_id uuid not null references public.authors(id) on delete restrict,
  author_order smallint not null default 1 check (author_order > 0),
  role text not null default 'Author',
  primary key (book_id, author_id)
);

create table public.series (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.book_series (
  book_id uuid not null references public.books(id) on delete cascade,
  series_id uuid not null references public.series(id) on delete cascade,
  series_order numeric(8,2),
  primary key (book_id, series_id)
);

create table public.editions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  book_id uuid not null references public.books(id) on delete cascade,
  owned boolean,
  preferred_copy boolean,
  isbn10 text,
  isbn13 text,
  publisher text,
  imprint text,
  publication_year integer check (publication_year between 0 and 3000),
  publication_date date,
  country text,
  language text,
  format text,
  binding text,
  edition_statement text,
  printing_impression text,
  number_line text,
  first_edition boolean,
  first_uk_edition boolean,
  first_paperback_edition boolean,
  dust_jacket boolean,
  condition text,
  page_count integer check (page_count is null or page_count > 0),
  acquisition_date date,
  acquisition_source text,
  acquisition_price numeric(12,2) check (acquisition_price is null or acquisition_price >= 0),
  currency char(3),
  cover_url text,
  cover_source text,
  cover_verified boolean,
  edition_match_confidence text,
  signed boolean,
  inscription text,
  location text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint editions_isbn10_format check (isbn10 is null or isbn10 ~ '^[0-9Xx-]{10,17}$'),
  constraint editions_isbn13_format check (isbn13 is null or isbn13 ~ '^[0-9-]{13,20}$')
);

create unique index editions_unique_isbn13 on public.editions(isbn13) where isbn13 is not null;

create table public.library_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  book_id uuid not null unique references public.books(id) on delete cascade,
  overall_status text not null default 'Recommended' check (overall_status in ('Recommended','Wishlist','Owned - Unread','Currently Reading','Read','Paused','DNF','Not Interested')),
  ownership_status text not null default 'Not Owned' check (ownership_status in ('Not Owned','Owned','On Order','Borrowed','Unknown')),
  reading_priority text check (reading_priority in ('High','Medium','Low','Someday')),
  current_edition_id uuid references public.editions(id) on delete set null,
  current_page integer check (current_page is null or current_page >= 0),
  total_pages integer check (total_pages is null or total_pages > 0),
  started_at timestamptz,
  completed_at timestamptz,
  user_rating_5 numeric(2,1) check (user_rating_5 is null or user_rating_5 between 0 and 5),
  user_review text,
  source text,
  notes text,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint library_page_not_beyond_total check (current_page is null or total_pages is null or current_page <= total_pages)
);

create table public.reading_sessions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  edition_id uuid references public.editions(id) on delete set null,
  session_type text not null default 'First Read' check (session_type in ('First Read','Reread')),
  status text not null default 'Planned' check (status in ('Planned','Reading','Paused','Completed','DNF')),
  started_at timestamptz,
  current_page integer check (current_page is null or current_page >= 0),
  total_pages integer check (total_pages is null or total_pages > 0),
  completed_at timestamptz,
  last_progress_at timestamptz,
  user_rating_5 numeric(2,1) check (user_rating_5 is null or user_rating_5 between 0 and 5),
  review text,
  format_read text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_page_not_beyond_total check (current_page is null or total_pages is null or current_page <= total_pages)
);

create unique index one_reading_session_per_book on public.reading_sessions(book_id) where status = 'Reading';

create table public.progress_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  session_id uuid not null references public.reading_sessions(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  page integer not null check (page >= 0),
  total_pages_snapshot integer check (total_pages_snapshot is null or total_pages_snapshot > 0),
  progress_percent numeric(6,3) generated always as (
    case when total_pages_snapshot is null or total_pages_snapshot = 0 then null else least(100::numeric, (page::numeric / total_pages_snapshot::numeric) * 100) end
  ) stored,
  logged_at timestamptz not null default now(),
  source text not null default 'frontend' check (source in ('frontend','chatgpt','migration','manual','import')),
  notes text
);

create index progress_logs_book_date_idx on public.progress_logs(book_id, logged_at desc);
create index progress_logs_session_date_idx on public.progress_logs(session_id, logged_at desc);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  recommended_by text,
  date_recommended date,
  recommendation_strength text check (recommendation_strength in ('Must Read','Strong','Good Fit','Wildcard')),
  match_score_10 numeric(3,1) check (match_score_10 is null or match_score_10 between 0 and 10),
  priority text check (priority in ('High','Medium','Low','Someday')),
  recommendation_status text check (recommendation_status in ('New','Shortlisted','Wishlist','Acquired','Reading','Read','Dismissed')),
  why_recommended text,
  key_themes text[] not null default '{}',
  similar_to text,
  frontend_featured boolean not null default false,
  frontend_shelf text,
  user_interest text check (user_interest in ('Very High','High','Medium','Low','Unknown')),
  dismissal_reason text,
  notes text,
  prediction_accuracy_5 numeric(2,1) check (prediction_accuracy_5 is null or prediction_accuracy_5 between 1 and 5),
  outcome text check (outcome in ('Better Than Expected','As Expected','Worse Than Expected','Not Yet Evaluated')),
  prediction_learning text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recommendations_status_idx on public.recommendations(recommendation_status, priority);

create table public.reading_feedback (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid references auth.users(id) on delete cascade,
  feedback_date date not null default current_date,
  book_id uuid not null references public.books(id) on delete cascade,
  session_id uuid references public.reading_sessions(id) on delete set null,
  page_chapter text,
  reading_stage text check (reading_stage in ('Early','Middle','Late','Finished','Post-read')),
  sentiment text check (sentiment in ('Positive','Mixed','Negative','Neutral')),
  aspect text,
  user_feedback text not null,
  preference_interpretation text,
  evidence_strength text check (evidence_strength in ('Weak','Moderate','Strong')),
  confidence text check (confidence in ('Low','Medium','High')),
  generalisable boolean,
  added_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reading_feedback_book_idx on public.reading_feedback(book_id, feedback_date desc);
create index reading_feedback_aspect_idx on public.reading_feedback(aspect);

create table public.taste_profile (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid references auth.users(id) on delete cascade,
  dimension text not null,
  preference text not null,
  direction text check (direction in ('Positive','Negative','Mixed','Unknown')),
  strength text check (strength in ('Weak','Moderate','Strong')),
  confidence text check (confidence in ('Low','Medium','High')),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  first_observed date,
  last_updated date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.taste_evidence (
  id bigint generated always as identity primary key,
  taste_profile_id uuid not null references public.taste_profile(id) on delete cascade,
  feedback_id uuid references public.reading_feedback(id) on delete cascade,
  book_id uuid references public.books(id) on delete cascade,
  relation text not null check (relation in ('supports','contradicts','context')),
  weight numeric(4,2) not null default 1.0 check (weight > 0),
  notes text,
  unique(taste_profile_id, feedback_id, relation)
);

create table public.book_external_ids (
  id bigint generated always as identity primary key,
  book_id uuid not null references public.books(id) on delete cascade,
  provider text not null,
  external_id text,
  url text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique(book_id, provider, external_id)
);

create table public.library_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  book_id uuid references public.books(id) on delete set null,
  session_id uuid references public.reading_sessions(id) on delete set null,
  event_type text not null,
  source text not null default 'chatgpt',
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index library_events_date_idx on public.library_events(occurred_at desc);
create index library_events_book_idx on public.library_events(book_id, occurred_at desc);

create trigger books_updated_at before update on public.books for each row execute function private.set_updated_at();
create trigger authors_updated_at before update on public.authors for each row execute function private.set_updated_at();
create trigger series_updated_at before update on public.series for each row execute function private.set_updated_at();
create trigger editions_updated_at before update on public.editions for each row execute function private.set_updated_at();
create trigger library_entries_updated_at before update on public.library_entries for each row execute function private.set_updated_at();
create trigger reading_sessions_updated_at before update on public.reading_sessions for each row execute function private.set_updated_at();
create trigger recommendations_updated_at before update on public.recommendations for each row execute function private.set_updated_at();
create trigger reading_feedback_updated_at before update on public.reading_feedback for each row execute function private.set_updated_at();
create trigger taste_profile_updated_at before update on public.taste_profile for each row execute function private.set_updated_at();

create or replace function public.claim_library(p_claim_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_owner uuid;
  v_hash text;
begin
  if v_uid is null then raise exception 'Authentication required'; end if;
  select owner_user_id, claim_code_hash into v_owner, v_hash from private.app_state where singleton = true for update;
  if v_owner is not null and v_owner <> v_uid then raise exception 'Library already claimed'; end if;
  if v_owner is null then
    if v_hash is null or encode(extensions.digest(p_claim_code,'sha256'),'hex') <> v_hash then raise exception 'Invalid claim code'; end if;
    update private.app_state set owner_user_id = v_uid, claim_code_hash = null, updated_at = now() where singleton = true;
    update public.library_entries set user_id = v_uid where user_id is null;
    update public.reading_sessions set user_id = v_uid where user_id is null;
    update public.progress_logs set user_id = v_uid where user_id is null;
    update public.recommendations set user_id = v_uid where user_id is null;
    update public.reading_feedback set user_id = v_uid where user_id is null;
    update public.taste_profile set user_id = v_uid where user_id is null;
    update public.library_events set user_id = v_uid where user_id is null;
  end if;
  return jsonb_build_object('claimed', true, 'user_id', v_uid);
end;
$$;

create or replace function public.start_reading(p_book_id uuid, p_edition_id uuid default null, p_total_pages integer default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session uuid;
  v_pages integer;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  select coalesce(p_total_pages, e.page_count, l.total_pages) into v_pages
  from public.library_entries l left join public.editions e on e.id = coalesce(p_edition_id, l.current_edition_id)
  where l.book_id = p_book_id;

  select id into v_session from public.reading_sessions
  where user_id=v_uid and book_id=p_book_id and status='Paused'
  order by started_at desc nulls last, created_at desc limit 1;

  if v_session is not null then
    update public.reading_sessions set status='Reading', edition_id=coalesce(p_edition_id,edition_id), total_pages=coalesce(v_pages,total_pages), last_progress_at=now() where id=v_session;
  else
    insert into public.reading_sessions(user_id,book_id,edition_id,session_type,status,started_at,current_page,total_pages,last_progress_at)
    values(v_uid,p_book_id,p_edition_id,'First Read','Reading',now(),0,v_pages,now()) returning id into v_session;
  end if;

  update public.library_entries set user_id=v_uid, overall_status='Currently Reading', current_edition_id=coalesce(p_edition_id,current_edition_id), current_page=coalesce(current_page,0), total_pages=coalesce(v_pages,total_pages), started_at=coalesce(started_at,now()), completed_at=null where book_id=p_book_id;
  insert into public.library_events(user_id,book_id,session_id,event_type,source,payload) values(v_uid,p_book_id,v_session,'reading_started','frontend',jsonb_build_object('total_pages',v_pages));
  return v_session;
end;
$$;

create or replace function public.update_reading_progress(p_book_id uuid, p_page integer, p_source text default 'frontend')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session uuid;
  v_total integer;
  v_pct numeric;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_page < 0 then raise exception 'Page must be non-negative'; end if;
  select id,total_pages into v_session,v_total from public.reading_sessions where user_id=v_uid and book_id=p_book_id and status='Reading' order by started_at desc nulls last,created_at desc limit 1;
  if v_session is null then raise exception 'No active reading session'; end if;
  if v_total is not null and p_page > v_total then raise exception 'Page exceeds total pages'; end if;
  update public.reading_sessions set current_page=p_page,last_progress_at=now() where id=v_session;
  update public.library_entries set current_page=p_page,total_pages=coalesce(total_pages,v_total) where book_id=p_book_id;
  insert into public.progress_logs(user_id,session_id,book_id,page,total_pages_snapshot,source) values(v_uid,v_session,p_book_id,p_page,v_total,case when p_source in ('frontend','chatgpt','migration','manual','import') then p_source else 'frontend' end);
  insert into public.library_events(user_id,book_id,session_id,event_type,source,payload) values(v_uid,p_book_id,v_session,'progress_updated',p_source,jsonb_build_object('page',p_page,'total_pages',v_total));
  v_pct := case when v_total is null or v_total=0 then null else round((p_page::numeric/v_total::numeric)*100,1) end;
  return jsonb_build_object('page',p_page,'total_pages',v_total,'progress_percent',v_pct);
end;
$$;

create or replace function public.finish_reading(p_book_id uuid, p_rating numeric default null, p_review text default null, p_source text default 'frontend')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_session uuid;
  v_total integer;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_rating is not null and (p_rating < 0 or p_rating > 5) then raise exception 'Rating must be between 0 and 5'; end if;
  select id,total_pages into v_session,v_total from public.reading_sessions where user_id=v_uid and book_id=p_book_id and status in ('Reading','Paused') order by started_at desc nulls last,created_at desc limit 1;
  if v_session is null then raise exception 'No active reading session'; end if;
  update public.reading_sessions set status='Completed',completed_at=now(),current_page=coalesce(total_pages,current_page),last_progress_at=now(),user_rating_5=coalesce(p_rating,user_rating_5),review=coalesce(p_review,review) where id=v_session;
  update public.library_entries set overall_status='Read',completed_at=now(),current_page=coalesce(total_pages,current_page),user_rating_5=coalesce(p_rating,user_rating_5),user_review=coalesce(p_review,user_review) where book_id=p_book_id;
  if v_total is not null then insert into public.progress_logs(user_id,session_id,book_id,page,total_pages_snapshot,source) values(v_uid,v_session,p_book_id,v_total,v_total,case when p_source in ('frontend','chatgpt','migration','manual','import') then p_source else 'frontend' end); end if;
  insert into public.library_events(user_id,book_id,session_id,event_type,source,payload) values(v_uid,p_book_id,v_session,'reading_finished',p_source,jsonb_build_object('rating',p_rating));
  return jsonb_build_object('completed',true,'session_id',v_session);
end;
$$;

create or replace view public.v_library with (security_invoker = true) as
select b.id,b.legacy_id,b.title,b.subtitle,
  coalesce(string_agg(distinct a.name, ', ' order by a.name) filter (where a.name is not null),'') as authors,
  max(s.name) as series,max(bs.series_order) as series_order,b.original_publication_year,b.fiction_nonfiction,b.primary_genre,b.themes_tags,b.language,b.synopsis,
  l.overall_status,l.ownership_status,l.reading_priority,l.current_edition_id,l.current_page,l.total_pages,
  case when l.current_page is not null and l.total_pages is not null and l.total_pages>0 then round((l.current_page::numeric/l.total_pages::numeric)*100,1) end as progress_percent,
  l.started_at,l.completed_at,l.user_rating_5,l.user_review,coalesce(e.cover_url,b.cover_url_preferred) as cover_url,e.format as edition_format,e.publisher,e.publication_year as edition_year,e.isbn10,e.isbn13,b.notes,l.updated_at
from public.books b join public.library_entries l on l.book_id=b.id
left join public.book_authors ba on ba.book_id=b.id left join public.authors a on a.id=ba.author_id
left join public.book_series bs on bs.book_id=b.id left join public.series s on s.id=bs.series_id
left join public.editions e on e.id=l.current_edition_id
group by b.id,l.id,e.id;

create or replace view public.v_currently_reading with (security_invoker = true) as select * from public.v_library where overall_status='Currently Reading';
create or replace view public.v_owned_unread with (security_invoker = true) as select * from public.v_library where overall_status='Owned - Unread';
create or replace view public.v_wishlist with (security_invoker = true) as select * from public.v_library where overall_status='Wishlist';
create or replace view public.v_recently_read with (security_invoker = true) as select * from public.v_library where overall_status='Read' order by completed_at desc nulls last,updated_at desc;
create or replace view public.v_reading_stats with (security_invoker = true) as
select count(*) filter (where overall_status='Read') as total_books_read,
count(*) filter (where overall_status='Read' and completed_at>=date_trunc('year',now())) as books_read_this_year,
count(*) filter (where overall_status='Currently Reading') as currently_reading,
count(*) filter (where overall_status='Owned - Unread') as owned_unread,
count(*) filter (where overall_status='Wishlist') as wishlist,
round(avg(user_rating_5) filter (where user_rating_5 is not null),2) as average_rating
from public.library_entries;

alter table public.books enable row level security;
alter table public.authors enable row level security;
alter table public.book_authors enable row level security;
alter table public.series enable row level security;
alter table public.book_series enable row level security;
alter table public.editions enable row level security;
alter table public.library_entries enable row level security;
alter table public.reading_sessions enable row level security;
alter table public.progress_logs enable row level security;
alter table public.recommendations enable row level security;
alter table public.reading_feedback enable row level security;
alter table public.taste_profile enable row level security;
alter table public.taste_evidence enable row level security;
alter table public.book_external_ids enable row level security;
alter table public.library_events enable row level security;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;

grant usage on schema public to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant usage,select on all sequences in schema public to authenticated;
grant execute on function public.claim_library(text) to authenticated;
grant execute on function public.start_reading(uuid,uuid,integer) to authenticated;
grant execute on function public.update_reading_progress(uuid,integer,text) to authenticated;
grant execute on function public.finish_reading(uuid,numeric,text,text) to authenticated;

create policy owner_all_books on public.books for all to authenticated using (private.is_owner()) with check (private.is_owner());
create policy owner_all_authors on public.authors for all to authenticated using (private.is_owner()) with check (private.is_owner());
create policy owner_all_book_authors on public.book_authors for all to authenticated using (private.is_owner()) with check (private.is_owner());
create policy owner_all_series on public.series for all to authenticated using (private.is_owner()) with check (private.is_owner());
create policy owner_all_book_series on public.book_series for all to authenticated using (private.is_owner()) with check (private.is_owner());
create policy owner_all_editions on public.editions for all to authenticated using (private.is_owner()) with check (private.is_owner());
create policy owner_library_entries on public.library_entries for all to authenticated using (private.is_owner() and user_id=(select auth.uid())) with check (private.is_owner() and user_id=(select auth.uid()));
create policy owner_reading_sessions on public.reading_sessions for all to authenticated using (private.is_owner() and user_id=(select auth.uid())) with check (private.is_owner() and user_id=(select auth.uid()));
create policy owner_progress_logs on public.progress_logs for all to authenticated using (private.is_owner() and user_id=(select auth.uid())) with check (private.is_owner() and user_id=(select auth.uid()));
create policy owner_recommendations on public.recommendations for all to authenticated using (private.is_owner() and user_id=(select auth.uid())) with check (private.is_owner() and user_id=(select auth.uid()));
create policy owner_reading_feedback on public.reading_feedback for all to authenticated using (private.is_owner() and user_id=(select auth.uid())) with check (private.is_owner() and user_id=(select auth.uid()));
create policy owner_taste_profile on public.taste_profile for all to authenticated using (private.is_owner() and user_id=(select auth.uid())) with check (private.is_owner() and user_id=(select auth.uid()));
create policy owner_taste_evidence on public.taste_evidence for all to authenticated using (private.is_owner()) with check (private.is_owner());
create policy owner_external_ids on public.book_external_ids for all to authenticated using (private.is_owner()) with check (private.is_owner());
create policy owner_library_events on public.library_events for all to authenticated using (private.is_owner() and user_id=(select auth.uid())) with check (private.is_owner() and user_id=(select auth.uid()));

alter default privileges for role postgres in schema public revoke select,insert,update,delete on tables from anon;
alter default privileges for role postgres in schema public revoke usage,select on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
