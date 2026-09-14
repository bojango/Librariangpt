create table public.reading_card_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  session_id uuid references public.reading_sessions(id) on delete set null,
  progress_log_id bigint references public.progress_logs(id) on delete set null,
  page integer check (page is null or page >= 0),
  progress_percent numeric check (progress_percent is null or progress_percent between 0 and 100),
  chapter_number text,
  chapter_title text,
  note_text text not null check (char_length(btrim(note_text)) between 1 and 400),
  source text not null default 'reading_checkin' check (char_length(btrim(source)) between 1 and 80),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reading_card_notes_user_book_generated_idx
  on public.reading_card_notes(user_id, book_id, generated_at desc);

create index reading_card_notes_session_generated_idx
  on public.reading_card_notes(session_id, generated_at desc)
  where session_id is not null;

create unique index reading_card_notes_exact_duplicate_idx
  on public.reading_card_notes(
    user_id,
    book_id,
    coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(page, -1),
    coalesce(progress_percent, -1::numeric),
    note_text
  );

create trigger reading_card_notes_updated_at
before update on public.reading_card_notes
for each row execute function private.set_updated_at();

alter table public.reading_card_notes enable row level security;
revoke all on public.reading_card_notes from public, anon, authenticated;
grant select on public.reading_card_notes to authenticated;
grant select, insert, update, delete on public.reading_card_notes to service_role;

create policy owner_select_reading_card_notes
on public.reading_card_notes for select
to authenticated
using (private.is_owner() and user_id = (select auth.uid()));

-- SECURITY DEFINER is intentional: authenticated clients have no direct INSERT grant;
-- the RPC performs owner, library, session, progress-log, and payload validation first.
create or replace function public.save_reading_card_note(
  p_book_id uuid,
  p_note_text text,
  p_page integer default null,
  p_progress_percent numeric default null,
  p_session_id uuid default null,
  p_progress_log_id bigint default null,
  p_chapter_number text default null,
  p_chapter_title text default null,
  p_source text default 'reading_checkin'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_note_text text := btrim(coalesce(p_note_text, ''));
  v_source text := btrim(coalesce(p_source, ''));
  v_session_id uuid;
  v_id uuid;
  v_generated_at timestamptz;
begin
  if v_uid is null or not private.is_owner() then
    raise exception 'Not authorized';
  end if;
  if v_note_text = '' then
    raise exception 'Note text is required';
  end if;
  if char_length(v_note_text) > 400 then
    raise exception 'Note text must be 400 characters or fewer';
  end if;
  if v_source = '' or char_length(v_source) > 80 then
    raise exception 'Invalid note source';
  end if;
  if p_page is not null and p_page < 0 then
    raise exception 'Page must be zero or greater';
  end if;
  if p_progress_percent is not null and (p_progress_percent < 0 or p_progress_percent > 100) then
    raise exception 'Progress percent must be between 0 and 100';
  end if;
  if not exists (
    select 1
    from public.library_entries le
    where le.user_id = v_uid and le.book_id = p_book_id
  ) then
    raise exception 'Book is not in your library';
  end if;

  if p_session_id is not null then
    select rs.id into v_session_id
    from public.reading_sessions rs
    where rs.id = p_session_id and rs.user_id = v_uid and rs.book_id = p_book_id;
    if v_session_id is null then raise exception 'Reading session does not belong to this book'; end if;
  else
    select rs.id into v_session_id
    from public.reading_sessions rs
    where rs.user_id = v_uid
      and rs.book_id = p_book_id
      and rs.status in ('Reading', 'Paused')
    order by rs.started_at desc nulls last, rs.created_at desc
    limit 1;
  end if;

  if p_progress_log_id is not null and not exists (
    select 1
    from public.progress_logs pl
    where pl.id = p_progress_log_id
      and pl.user_id = v_uid
      and pl.book_id = p_book_id
      and (v_session_id is null or pl.session_id = v_session_id)
  ) then
    raise exception 'Progress log does not belong to this reading session';
  end if;

  insert into public.reading_card_notes(
    user_id, book_id, session_id, progress_log_id, page, progress_percent,
    chapter_number, chapter_title, note_text, source
  ) values (
    v_uid, p_book_id, v_session_id, p_progress_log_id, p_page, p_progress_percent,
    nullif(btrim(p_chapter_number), ''), nullif(btrim(p_chapter_title), ''), v_note_text, v_source
  )
  on conflict do nothing
  returning id, generated_at into v_id, v_generated_at;

  if v_id is null then
    select n.id, n.generated_at into v_id, v_generated_at
    from public.reading_card_notes n
    where n.user_id = v_uid
      and n.book_id = p_book_id
      and n.session_id is not distinct from v_session_id
      and n.page is not distinct from p_page
      and n.progress_percent is not distinct from p_progress_percent
      and n.note_text = v_note_text
    order by n.generated_at desc
    limit 1;
    return jsonb_build_object('saved', false, 'id', v_id, 'generated_at', v_generated_at);
  end if;

  return jsonb_build_object('saved', true, 'id', v_id, 'generated_at', v_generated_at);
end;
$$;

revoke all on function public.save_reading_card_note(uuid,text,integer,numeric,uuid,bigint,text,text,text) from public, anon, authenticated;
grant execute on function public.save_reading_card_note(uuid,text,integer,numeric,uuid,bigint,text,text,text) to authenticated;

create or replace view public.v_latest_reading_card_notes
with (security_invoker = true) as
select
  note.book_id,
  note.session_id,
  note.note_text,
  note.page,
  note.progress_percent,
  note.chapter_number,
  note.chapter_title,
  note.source,
  note.generated_at
from public.library_entries le
join lateral (
  select rs.id
  from public.reading_sessions rs
  where rs.user_id = le.user_id
    and rs.book_id = le.book_id
    and rs.status = 'Reading'
  order by rs.started_at desc nulls last, rs.created_at desc
  limit 1
) active_session on true
join lateral (
  select n.*
  from public.reading_card_notes n
  where n.user_id = le.user_id
    and n.book_id = le.book_id
    and n.session_id = active_session.id
  order by n.generated_at desc, n.created_at desc, n.id desc
  limit 1
) note on true
where le.user_id = (select auth.uid())
  and le.overall_status = 'Currently Reading';

revoke all on public.v_latest_reading_card_notes from public, anon;
grant select on public.v_latest_reading_card_notes to authenticated, service_role;

alter table public.editions drop constraint if exists editions_chapter_map_status_check;
alter table public.editions add constraint editions_chapter_map_status_check
  check (chapter_map_status is null or chapter_map_status in ('available','partial','manual','not_found','failed'));

create or replace view public.v_library_chapters with (security_invoker = true) as
select v.id, v.legacy_id, v.title, v.subtitle, v.authors, v.series, v.series_order,
  v.original_publication_year, v.fiction_nonfiction, v.primary_genre, v.themes_tags, v.language, v.synopsis,
  v.overall_status, v.ownership_status, v.reading_priority, v.current_edition_id, v.reference_edition_id,
  v.display_edition_id, v.current_page, v.total_pages, v.progress_percent, v.started_at, v.completed_at,
  v.user_rating_5, v.user_review, v.review_notes, v.reviewed_at, v.cover_url, v.cover_source, v.cover_verified,
  v.edition_format, v.binding, v.publisher, v.imprint, v.edition_year, v.edition_date, v.edition_statement,
  v.printing_impression, v.number_line, v.country, v.condition, v.isbn10, v.isbn13, v.edition_page_count,
  v.open_library_edition_id, v.open_library_work_id, v.google_books_volume_id, v.edition_metadata_source,
  v.metadata_last_fetched_at, v.metadata_match_confidence, v.signed, v.inscription, v.physical_dimensions,
  v.public_rating_provider, v.public_rating_5, v.public_rating_count, v.public_review_count,
  v.public_rating_url, v.public_rating_fetched_at, v.notes,
  ch.id as current_chapter_id, ch.sequence_no as current_chapter_sequence,
  ch.chapter_number as current_chapter_number, ch.chapter_title as current_chapter_title,
  ch.entry_type as current_chapter_type, ch.start_page as current_chapter_start_page,
  ch.end_page as current_chapter_end_page,
  e.chapter_map_source, e.chapter_map_status, e.chapter_map_last_checked_at,
  exists(select 1 from public.edition_chapters mapped where mapped.edition_id = v.display_edition_id) as has_chapter_map
from public.v_library v
left join public.editions e on e.id = v.display_edition_id
left join lateral (
  select c.*
  from public.edition_chapters c
  where c.edition_id = v.display_edition_id
    and v.current_page is not null
    and c.start_page <= v.current_page
    and (c.end_page is null or c.end_page >= v.current_page)
  order by c.start_page desc, c.level desc, c.sequence_no desc
  limit 1
) ch on true;

revoke all on public.v_library_chapters from public, anon;
grant select on public.v_library_chapters to authenticated, service_role;

create or replace function public.reading_checkin_progress_state(p_user_id uuid)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
with current_entry as (
  select
    le.id as library_entry_id, le.book_id, le.current_edition_id, le.current_page,
    le.total_pages, le.started_at, le.updated_at, b.title,
    coalesce((
      select string_agg(a.name, ', ' order by ba.author_order)
      from public.book_authors ba
      join public.authors a on a.id = ba.author_id
      where ba.book_id = b.id
    ), '') as authors
  from public.library_entries le
  join public.books b on b.id = le.book_id
  where le.user_id = p_user_id and le.overall_status = 'Currently Reading'
  order by le.updated_at desc
  limit 1
), active_session as (
  select rs.*
  from public.reading_sessions rs
  join current_entry ce on ce.book_id = rs.book_id
  where rs.user_id = p_user_id and rs.status = 'Reading'
  order by rs.updated_at desc
  limit 1
), latest_progress as (
  select pl.*
  from public.progress_logs pl
  join current_entry ce on ce.book_id = pl.book_id
  left join active_session s on true
  where pl.user_id = p_user_id and (s.id is null or pl.session_id = s.id)
  order by pl.logged_at desc, pl.id desc
  limit 1
), last_checkin as (
  select e.*
  from public.library_events e
  join current_entry ce on ce.book_id = e.book_id
  left join active_session s on true
  where e.user_id = p_user_id
    and e.event_type = 'reading_checkin'
    and (s.id is null or e.session_id = s.id or e.session_id is null)
  order by e.occurred_at desc, e.id desc
  limit 1
)
select jsonb_build_object(
  'current_book', case when ce.book_id is null then null else jsonb_build_object(
    'library_entry_id', ce.library_entry_id, 'book_id', ce.book_id, 'title', ce.title,
    'authors', ce.authors, 'current_edition_id', ce.current_edition_id,
    'current_page', coalesce(s.current_page, ce.current_page),
    'total_pages', coalesce(s.total_pages, ce.total_pages),
    'progress_percent', case
      when coalesce(s.total_pages, ce.total_pages) is null or coalesce(s.total_pages, ce.total_pages) = 0 then null
      else round(100.0 * coalesce(s.current_page, ce.current_page, 0)::numeric / coalesce(s.total_pages, ce.total_pages)::numeric, 1)
    end,
    'started_at', coalesce(s.started_at, ce.started_at), 'last_progress_at', s.last_progress_at
  ) end,
  'active_session', case when s.id is null then null else jsonb_build_object(
    'session_id', s.id, 'status', s.status, 'session_type', s.session_type,
    'edition_id', s.edition_id, 'current_page', s.current_page, 'total_pages', s.total_pages,
    'started_at', s.started_at, 'last_progress_at', s.last_progress_at
  ) end,
  'latest_progress', case when lp.id is null then null else jsonb_build_object(
    'id', lp.id, 'page', lp.page, 'total_pages_snapshot', lp.total_pages_snapshot,
    'progress_percent', round(lp.progress_percent, 1), 'logged_at', lp.logged_at, 'source', lp.source
  ) end,
  'last_checkin', case when lc.id is null then null else jsonb_build_object(
    'id', lc.id, 'occurred_at', lc.occurred_at, 'payload', lc.payload
  ) end,
  'pages_since_last_checkin', case
    when lc.id is null then null
    when (lc.payload->>'current_page') ~ '^[0-9]+$'
      then coalesce(s.current_page, ce.current_page, 0) - (lc.payload->>'current_page')::integer
    else null
  end
)
from current_entry ce
left join active_session s on true
left join latest_progress lp on true
left join last_checkin lc on true
union all
select jsonb_build_object(
  'current_book', null, 'active_session', null, 'latest_progress', null,
  'last_checkin', null, 'pages_since_last_checkin', null
)
where not exists (select 1 from current_entry)
limit 1;
$$;

create or replace function public.reading_checkin_snapshot(p_user_id uuid)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
with state as (
  select public.reading_checkin_progress_state(p_user_id) as j
), ids as (
  select
    nullif(state.j->'current_book'->>'book_id', '')::uuid as book_id,
    nullif(state.j->'current_book'->>'current_edition_id', '')::uuid as edition_id,
    nullif(state.j->'active_session'->>'session_id', '')::uuid as session_id,
    nullif(state.j->'current_book'->>'current_page', '')::integer as current_page
  from state
)
select jsonb_build_object(
  'generated_at', now(),
  'state', state.j,
  'current_chapter', (
    select jsonb_build_object(
      'sequence_no', ec.sequence_no, 'entry_type', ec.entry_type,
      'chapter_number', ec.chapter_number, 'chapter_title', ec.chapter_title,
      'start_page', ec.start_page, 'end_page', ec.end_page, 'verified', ec.verified
    )
    from ids join public.edition_chapters ec on ec.edition_id = ids.edition_id
    where ids.current_page is not null and ec.start_page <= ids.current_page
      and (ec.end_page is null or ec.end_page >= ids.current_page)
    order by ec.start_page desc, ec.sequence_no desc limit 1
  ),
  'latest_card_note', (
    select jsonb_build_object(
      'id', n.id, 'book_id', n.book_id, 'session_id', n.session_id,
      'note_text', n.note_text, 'page', n.page, 'progress_percent', n.progress_percent,
      'chapter_number', n.chapter_number, 'chapter_title', n.chapter_title,
      'generated_at', n.generated_at
    )
    from ids join public.reading_card_notes n on n.book_id = ids.book_id
    where ids.session_id is not null and n.user_id = p_user_id and n.session_id = ids.session_id
    order by n.generated_at desc, n.created_at desc, n.id desc limit 1
  ),
  'recent_progress', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.logged_at desc, x.id desc)
    from (
      select pl.id, pl.page, pl.total_pages_snapshot, round(pl.progress_percent, 1) as progress_percent,
             pl.logged_at, pl.source, pl.notes
      from ids join public.progress_logs pl on pl.book_id = ids.book_id
      where pl.user_id = p_user_id and (ids.session_id is null or pl.session_id = ids.session_id)
      order by pl.logged_at desc, pl.id desc limit 10
    ) x
  ), '[]'::jsonb),
  'recent_feedback', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.feedback_date desc, x.created_at desc)
    from (
      select rf.id, rf.feedback_date, rf.page_chapter, rf.reading_stage, rf.sentiment, rf.aspect,
             rf.user_feedback, rf.preference_interpretation, rf.evidence_strength, rf.confidence,
             rf.generalisable, rf.created_at
      from ids join public.reading_feedback rf on rf.book_id = ids.book_id
      where rf.user_id = p_user_id
        and (ids.session_id is null or rf.session_id = ids.session_id or rf.session_id is null)
      order by rf.feedback_date desc, rf.created_at desc limit 12
    ) x
  ), '[]'::jsonb),
  'recent_events', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.occurred_at desc, x.id desc)
    from (
      select e.id, e.event_type, e.source, e.payload, e.occurred_at
      from ids join public.library_events e on e.book_id = ids.book_id
      where e.user_id = p_user_id
        and (ids.session_id is null or e.session_id = ids.session_id or e.session_id is null)
      order by e.occurred_at desc, e.id desc limit 15
    ) x
  ), '[]'::jsonb),
  'taste_profile', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.updated_at desc)
    from (
      select tp.id, tp.dimension, tp.preference, tp.direction, tp.strength, tp.confidence,
             tp.evidence_count, tp.first_observed, tp.last_updated, tp.notes, tp.updated_at
      from public.taste_profile tp where tp.user_id = p_user_id
      order by tp.updated_at desc limit 30
    ) x
  ), '[]'::jsonb),
  'up_next', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.position)
    from (
      select uq.position, uq.source, uq.reason, uq.ai_score, uq.confidence, uq.locked,
             b.id as book_id, b.title,
             coalesce((select string_agg(a.name, ', ' order by ba.author_order)
               from public.book_authors ba join public.authors a on a.id = ba.author_id
               where ba.book_id = b.id), '') as authors
      from public.up_next_queue uq join public.books b on b.id = uq.book_id
      where uq.user_id = p_user_id order by uq.position limit 5
    ) x
  ), '[]'::jsonb),
  'active_recommendations', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.display_rank nulls last, x.match_score_10 desc nulls last)
    from (
      select r.id, r.book_id, b.title,
             coalesce((select string_agg(a.name, ', ' order by ba.author_order)
               from public.book_authors ba join public.authors a on a.id = ba.author_id
               where ba.book_id = b.id), '') as authors,
             r.recommendation_strength, r.match_score_10, r.match_confidence, r.why_recommended,
             r.frontend_featured, r.display_rank, r.last_evaluated_at
      from public.recommendations r join public.books b on b.id = r.book_id
      where (r.user_id = p_user_id or r.user_id is null) and r.is_active = true
      order by r.display_rank nulls last, r.match_score_10 desc nulls last limit 20
    ) x
  ), '[]'::jsonb)
)
from state;
$$;

revoke all on function public.reading_checkin_progress_state(uuid) from public, anon, authenticated;
revoke all on function public.reading_checkin_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.reading_checkin_progress_state(uuid) to service_role;
grant execute on function public.reading_checkin_snapshot(uuid) to service_role;

comment on table public.reading_card_notes is
  'Historical, session-scoped Librarian notes generated by the external Reading Check-in automation.';
comment on function public.save_reading_card_note(uuid,text,integer,numeric,uuid,bigint,text,text,text) is
  'Authenticated owner-only write path for durable reading-card notes; exact duplicates are returned without reinsertion.';
