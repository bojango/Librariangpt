-- Restricted service-role entrypoints for the external Reading Check-in bridge.
-- The caller never supplies a user id and receives no generic SQL/table access.

create or replace function public.reading_checkin_bridge_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
begin
  select s.owner_user_id
  into v_owner_id
  from private.app_state s
  where s.singleton = true;

  if v_owner_id is null then
    raise exception 'Reading bridge owner is not configured';
  end if;

  return public.reading_checkin_snapshot(v_owner_id);
end;
$$;

revoke all on function public.reading_checkin_bridge_snapshot() from public, anon, authenticated;
grant execute on function public.reading_checkin_bridge_snapshot() to service_role;

comment on function public.reading_checkin_bridge_snapshot() is
  'Service-role-only bridge entrypoint returning the configured owner reading_checkin_snapshot().';

create or replace function public.save_reading_card_note_bridge(
  p_note_text text,
  p_book_id uuid default null,
  p_page integer default null,
  p_progress_percent numeric default null,
  p_chapter_number text default null,
  p_chapter_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid;
  v_book_id uuid;
  v_snapshot jsonb;
  v_note_text text := btrim(coalesce(p_note_text, ''));
  v_chapter_number text := nullif(btrim(p_chapter_number), '');
  v_chapter_title text := nullif(btrim(p_chapter_title), '');
  v_session_id uuid;
  v_edition_id uuid;
  v_current_page integer;
  v_total_pages integer;
  v_page integer;
  v_progress_percent numeric;
  v_page_tolerance integer;
  v_canonical_chapter_number text;
  v_canonical_chapter_title text;
  v_previous record;
  v_id uuid;
  v_generated_at timestamptz;
begin
  select s.owner_user_id
  into v_owner_id
  from private.app_state s
  where s.singleton = true;

  if v_owner_id is null then
    raise exception 'Reading bridge owner is not configured';
  end if;

  if v_note_text = '' then
    return jsonb_build_object('ok', false, 'error', 'note_required');
  end if;
  if char_length(v_note_text) > 400 then
    return jsonb_build_object('ok', false, 'error', 'note_too_long');
  end if;
  if v_chapter_number is not null and char_length(v_chapter_number) > 80 then
    return jsonb_build_object('ok', false, 'error', 'invalid_chapter');
  end if;
  if v_chapter_title is not null and char_length(v_chapter_title) > 300 then
    return jsonb_build_object('ok', false, 'error', 'invalid_chapter');
  end if;
  if p_page is not null and p_page < 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_page');
  end if;
  if p_progress_percent is not null
     and (p_progress_percent < 0 or p_progress_percent > 100) then
    return jsonb_build_object('ok', false, 'error', 'invalid_progress');
  end if;

  v_snapshot := public.reading_checkin_snapshot(v_owner_id);
  v_book_id := coalesce(
    p_book_id,
    nullif(v_snapshot->'state'->'current_book'->>'book_id', '')::uuid
  );

  if v_book_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_current_book');
  end if;

  select
    rs.id,
    coalesce(rs.edition_id, le.current_edition_id, b.reference_edition_id),
    coalesce(rs.current_page, le.current_page),
    coalesce(rs.total_pages, le.total_pages, ed.page_count)
  into v_session_id, v_edition_id, v_current_page, v_total_pages
  from public.library_entries le
  join public.books b on b.id = le.book_id
  left join lateral (
    select active.*
    from public.reading_sessions active
    where active.user_id = v_owner_id
      and active.book_id = le.book_id
      and active.status = 'Reading'
    order by active.started_at desc nulls last, active.created_at desc
    limit 1
  ) rs on true
  left join public.editions ed
    on ed.id = coalesce(rs.edition_id, le.current_edition_id, b.reference_edition_id)
  where le.user_id = v_owner_id
    and le.book_id = v_book_id
    and le.overall_status = 'Currently Reading';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'book_not_currently_reading');
  end if;
  if v_session_id is null then
    return jsonb_build_object('ok', false, 'error', 'active_session_unavailable');
  end if;

  v_page_tolerance := greatest(2, coalesce(ceil(v_total_pages * 0.01)::integer, 2));
  if p_page is not null and v_total_pages is not null
     and p_page > v_total_pages + greatest(5, ceil(v_total_pages * 0.02)::integer) then
    return jsonb_build_object('ok', false, 'error', 'invalid_page');
  end if;
  if p_page is not null and v_current_page is not null
     and abs(p_page - v_current_page) > v_page_tolerance then
    return jsonb_build_object('ok', false, 'error', 'stale_progress');
  end if;

  v_page := coalesce(v_current_page, p_page);
  if v_total_pages is not null and v_total_pages > 0 and v_page is not null then
    v_progress_percent := round(least(100, 100.0 * v_page::numeric / v_total_pages::numeric), 1);
  else
    v_progress_percent := p_progress_percent;
  end if;

  if p_progress_percent is not null and v_progress_percent is not null
     and abs(p_progress_percent - v_progress_percent) > 1.0 then
    return jsonb_build_object('ok', false, 'error', 'stale_progress');
  end if;

  if v_edition_id is not null and v_page is not null then
    select ec.chapter_number, ec.chapter_title
    into v_canonical_chapter_number, v_canonical_chapter_title
    from public.edition_chapters ec
    where ec.edition_id = v_edition_id
      and ec.start_page <= v_page
      and (ec.end_page is null or ec.end_page >= v_page)
    order by ec.start_page desc, ec.level desc, ec.sequence_no desc
    limit 1;
  end if;

  if v_canonical_chapter_number is not null then
    if v_chapter_number is not null
       and lower(v_chapter_number) <> lower(btrim(v_canonical_chapter_number)) then
      return jsonb_build_object('ok', false, 'error', 'stale_chapter');
    end if;
    v_chapter_number := btrim(v_canonical_chapter_number);
  end if;
  if v_canonical_chapter_title is not null then
    if v_chapter_title is not null
       and lower(v_chapter_title) <> lower(btrim(v_canonical_chapter_title)) then
      return jsonb_build_object('ok', false, 'error', 'stale_chapter');
    end if;
    v_chapter_title := btrim(v_canonical_chapter_title);
  end if;

  -- Serialize requests for one reading session so GET retries/prefetches are harmless.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::text || ':' || v_book_id::text || ':' || v_session_id::text, 0)
  );

  select n.id, n.generated_at
  into v_id, v_generated_at
  from public.reading_card_notes n
  where n.user_id = v_owner_id
    and n.book_id = v_book_id
    and n.session_id = v_session_id
    and n.page is not distinct from v_page
    and n.progress_percent is not distinct from v_progress_percent
    and n.note_text = v_note_text
  order by n.generated_at desc, n.id desc
  limit 1;

  if v_id is not null then
    return jsonb_build_object(
      'ok', true, 'saved', false, 'duplicate', true,
      'id', v_id, 'generated_at', v_generated_at
    );
  end if;

  select n.id, n.generated_at, n.page, n.progress_percent,
         n.chapter_number, n.chapter_title
  into v_previous
  from public.reading_card_notes n
  where n.user_id = v_owner_id
    and n.book_id = v_book_id
    and n.session_id = v_session_id
    and n.source = 'reading_checkin_bridge'
  order by n.generated_at desc, n.id desc
  limit 1;

  if v_previous.id is not null
     and v_previous.generated_at > now() - interval '30 minutes'
     and v_previous.page is not distinct from v_page
     and v_previous.progress_percent is not distinct from v_progress_percent
     and v_previous.chapter_number is not distinct from v_chapter_number
     and v_previous.chapter_title is not distinct from v_chapter_title then
    return jsonb_build_object(
      'ok', true, 'saved', false, 'duplicate', false, 'throttled', true,
      'id', v_previous.id, 'generated_at', v_previous.generated_at
    );
  end if;

  insert into public.reading_card_notes(
    user_id, book_id, session_id, page, progress_percent,
    chapter_number, chapter_title, note_text, source
  ) values (
    v_owner_id, v_book_id, v_session_id, v_page, v_progress_percent,
    v_chapter_number, v_chapter_title, v_note_text, 'reading_checkin_bridge'
  )
  on conflict do nothing
  returning id, generated_at into v_id, v_generated_at;

  if v_id is null then
    select n.id, n.generated_at
    into v_id, v_generated_at
    from public.reading_card_notes n
    where n.user_id = v_owner_id
      and n.book_id = v_book_id
      and n.session_id = v_session_id
      and n.page is not distinct from v_page
      and n.progress_percent is not distinct from v_progress_percent
      and n.note_text = v_note_text
    order by n.generated_at desc, n.id desc
    limit 1;

    return jsonb_build_object(
      'ok', true, 'saved', false, 'duplicate', true,
      'id', v_id, 'generated_at', v_generated_at
    );
  end if;

  return jsonb_build_object(
    'ok', true, 'saved', true, 'duplicate', false,
    'id', v_id, 'generated_at', v_generated_at
  );
end;
$$;

revoke all on function public.save_reading_card_note_bridge(text,uuid,integer,numeric,text,text)
  from public, anon, authenticated;
grant execute on function public.save_reading_card_note_bridge(text,uuid,integer,numeric,text,text)
  to service_role;

comment on function public.save_reading_card_note_bridge(text,uuid,integer,numeric,text,text) is
  'Service-role-only, owner-fixed write path for the restricted Reading Check-in bridge.';
