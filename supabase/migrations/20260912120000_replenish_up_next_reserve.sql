-- Keep five visible Up Next books backed by three durable reserve entries.

create or replace function private.replenish_up_next(
  p_user_id uuid,
  p_target_count integer default 8
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_count integer;
  v_max_position integer;
  v_needed integer;
begin
  if p_user_id is null then return; end if;

  select count(*), coalesce(max(position), 0)
    into v_current_count, v_max_position
  from public.up_next_queue
  where user_id = p_user_id;

  v_needed := greatest(p_target_count, 0) - v_current_count;
  if v_needed <= 0 then return; end if;

  insert into public.up_next_queue(
    user_id,
    book_id,
    position,
    source,
    reason,
    ai_score,
    confidence,
    locked
  )
  select
    p_user_id,
    candidate.book_id,
    (v_max_position + row_number() over (order by candidate.candidate_order))::integer,
    'AI',
    candidate.why_recommended,
    candidate.match_score_10,
    candidate.match_confidence,
    false
  from (
    select
      le.book_id,
      r.why_recommended,
      r.match_score_10,
      r.match_confidence,
      row_number() over (
        order by
          (r.recommendation_id is not null) desc,
          r.match_score_10 desc nulls last,
          case le.reading_priority when 'High' then 1 when 'Medium' then 2 when 'Low' then 3 else 4 end,
          r.display_rank asc nulls last,
          le.updated_at desc,
          le.book_id
      ) as candidate_order
    from public.library_entries le
    left join lateral (
      select
        rec.id as recommendation_id,
        rec.why_recommended,
        rec.match_score_10,
        rec.match_confidence,
        rec.display_rank
      from public.recommendations rec
      where rec.user_id = p_user_id
        and rec.book_id = le.book_id
      order by rec.date_recommended desc nulls last, rec.created_at desc
      limit 1
    ) r on true
    where le.user_id = p_user_id
      and le.overall_status = 'Owned - Unread'
      and not exists (
        select 1
        from public.up_next_queue queued
        where queued.user_id = p_user_id
          and queued.book_id = le.book_id
      )
  ) candidate
  order by candidate.candidate_order
  limit v_needed;
end;
$$;

revoke all on function private.replenish_up_next(uuid, integer) from public;

create or replace function private.remove_started_book_from_up_next()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.overall_status = 'Currently Reading'
    and old.overall_status is distinct from new.overall_status then
    delete from public.up_next_queue
    where book_id = new.book_id
      and user_id = new.user_id;

    with ranked as (
      select id, row_number() over (order by position, added_at) as position
      from public.up_next_queue
      where user_id = new.user_id
    )
    update public.up_next_queue queued
    set position = ranked.position
    from ranked
    where queued.id = ranked.id;

    perform private.replenish_up_next(new.user_id, 8);
  end if;
  return new;
end;
$$;

do $$
declare
  library_user record;
begin
  for library_user in
    select distinct user_id
    from public.library_entries
    where user_id is not null
  loop
    perform private.replenish_up_next(library_user.user_id, 8);
  end loop;
end;
$$;
