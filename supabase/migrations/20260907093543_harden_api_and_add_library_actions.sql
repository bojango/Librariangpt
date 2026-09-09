-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

revoke execute on function public.claim_library(text) from public, anon;
grant execute on function public.claim_library(text) to authenticated;
revoke execute on function public.start_reading(uuid,uuid,integer) from public, anon;
revoke execute on function public.update_reading_progress(uuid,integer,text) from public, anon;
revoke execute on function public.finish_reading(uuid,numeric,text,text) from public, anon;
grant execute on function public.start_reading(uuid,uuid,integer) to authenticated;
grant execute on function public.update_reading_progress(uuid,integer,text) to authenticated;
grant execute on function public.finish_reading(uuid,numeric,text,text) to authenticated;

create index if not exists app_state_owner_user_idx on private.app_state(owner_user_id);
create index if not exists book_authors_author_idx on public.book_authors(author_id);
create index if not exists book_series_series_idx on public.book_series(series_id);
create index if not exists editions_book_idx on public.editions(book_id);
create index if not exists library_entries_current_edition_idx on public.library_entries(current_edition_id);
create index if not exists library_entries_user_idx on public.library_entries(user_id);
create index if not exists library_events_session_idx on public.library_events(session_id);
create index if not exists library_events_user_idx on public.library_events(user_id);
create index if not exists progress_logs_user_idx on public.progress_logs(user_id);
create index if not exists reading_feedback_session_idx on public.reading_feedback(session_id);
create index if not exists reading_feedback_user_idx on public.reading_feedback(user_id);
create index if not exists reading_sessions_edition_idx on public.reading_sessions(edition_id);
create index if not exists reading_sessions_user_idx on public.reading_sessions(user_id);
create index if not exists recommendations_book_idx on public.recommendations(book_id);
create index if not exists recommendations_user_idx on public.recommendations(user_id);
create index if not exists taste_evidence_book_idx on public.taste_evidence(book_id);
create index if not exists taste_evidence_feedback_idx on public.taste_evidence(feedback_id);
create index if not exists taste_profile_user_idx on public.taste_profile(user_id);

create or replace function public.pause_reading(p_book_id uuid, p_source text default 'frontend')
returns jsonb language plpgsql set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_session uuid;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  select id into v_session from public.reading_sessions where user_id=v_uid and book_id=p_book_id and status='Reading' order by started_at desc nulls last,created_at desc limit 1;
  if v_session is null then raise exception 'No active reading session'; end if;
  update public.reading_sessions set status='Paused',last_progress_at=now() where id=v_session;
  update public.library_entries set overall_status='Paused' where book_id=p_book_id;
  insert into public.library_events(user_id,book_id,session_id,event_type,source) values(v_uid,p_book_id,v_session,'reading_paused',p_source);
  return jsonb_build_object('paused',true,'session_id',v_session);
end; $$;

create or replace function public.dnf_reading(p_book_id uuid, p_notes text default null, p_source text default 'frontend')
returns jsonb language plpgsql set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_session uuid;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  select id into v_session from public.reading_sessions where user_id=v_uid and book_id=p_book_id and status in ('Reading','Paused') order by started_at desc nulls last,created_at desc limit 1;
  if v_session is null then raise exception 'No active or paused reading session'; end if;
  update public.reading_sessions set status='DNF',last_progress_at=now(),notes=concat_ws(E'\n',notes,p_notes) where id=v_session;
  update public.library_entries set overall_status='DNF',notes=concat_ws(E'\n',notes,p_notes) where book_id=p_book_id;
  insert into public.library_events(user_id,book_id,session_id,event_type,source,payload) values(v_uid,p_book_id,v_session,'reading_dnf',p_source,jsonb_build_object('notes',p_notes));
  return jsonb_build_object('dnf',true,'session_id',v_session);
end; $$;

create or replace function public.set_library_status(p_book_id uuid, p_status text, p_ownership text default null, p_priority text default null, p_source text default 'frontend')
returns jsonb language plpgsql set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_status not in ('Recommended','Wishlist','Owned - Unread','Currently Reading','Read','Paused','DNF','Not Interested') then raise exception 'Invalid status'; end if;
  if p_ownership is not null and p_ownership not in ('Not Owned','Owned','On Order','Borrowed','Unknown') then raise exception 'Invalid ownership'; end if;
  if p_priority is not null and p_priority not in ('High','Medium','Low','Someday') then raise exception 'Invalid priority'; end if;
  update public.library_entries set user_id=v_uid,overall_status=p_status,ownership_status=coalesce(p_ownership,ownership_status),reading_priority=coalesce(p_priority,reading_priority) where book_id=p_book_id;
  if not found then raise exception 'Book is not in library'; end if;
  insert into public.library_events(user_id,book_id,event_type,source,payload) values(v_uid,p_book_id,'library_status_changed',p_source,jsonb_build_object('status',p_status,'ownership',p_ownership,'priority',p_priority));
  return jsonb_build_object('status',p_status,'ownership',p_ownership,'priority',p_priority);
end; $$;

revoke execute on function public.pause_reading(uuid,text) from public,anon;
revoke execute on function public.dnf_reading(uuid,text,text) from public,anon;
revoke execute on function public.set_library_status(uuid,text,text,text,text) from public,anon;
grant execute on function public.pause_reading(uuid,text) to authenticated;
grant execute on function public.dnf_reading(uuid,text,text) to authenticated;
grant execute on function public.set_library_status(uuid,text,text,text,text) to authenticated;

drop view if exists public.v_currently_reading;
drop view if exists public.v_owned_unread;
drop view if exists public.v_wishlist;
drop view if exists public.v_recently_read;
drop view if exists public.v_library;

create view public.v_library with (security_invoker = true) as
select b.id,b.legacy_id,b.title,b.subtitle,
  coalesce((select string_agg(a2.name, ', ' order by ba2.author_order) from public.book_authors ba2 join public.authors a2 on a2.id=ba2.author_id where ba2.book_id=b.id),'') as authors,
  (select s2.name from public.book_series bs2 join public.series s2 on s2.id=bs2.series_id where bs2.book_id=b.id order by bs2.series_order nulls last limit 1) as series,
  ((select bs3.series_order from public.book_series bs3 where bs3.book_id=b.id order by bs3.series_order nulls last limit 1))::numeric as series_order,
  b.original_publication_year,b.fiction_nonfiction,b.primary_genre,b.themes_tags,b.language,b.synopsis,
  l.overall_status,l.ownership_status,l.reading_priority,l.current_edition_id,l.current_page,l.total_pages,
  case when l.current_page is not null and l.total_pages is not null and l.total_pages>0 then round((l.current_page::numeric/l.total_pages::numeric)*100,1) end as progress_percent,
  l.started_at,l.completed_at,l.user_rating_5,l.user_review,coalesce(e.cover_url,b.cover_url_preferred) as cover_url,
  e.format as edition_format,e.publisher,e.publication_year as edition_year,e.isbn10,e.isbn13,b.notes,l.updated_at,e.signed
from public.books b join public.library_entries l on l.book_id=b.id left join public.editions e on e.id=l.current_edition_id;

create view public.v_currently_reading with (security_invoker = true) as select * from public.v_library where overall_status='Currently Reading';
create view public.v_owned_unread with (security_invoker = true) as select * from public.v_library where overall_status='Owned - Unread';
create view public.v_wishlist with (security_invoker = true) as select * from public.v_library where overall_status='Wishlist';
create view public.v_recently_read with (security_invoker = true) as select * from public.v_library where overall_status='Read' order by completed_at desc nulls last,updated_at desc;

