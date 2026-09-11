-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

alter table public.recommendations
  add column if not exists is_active boolean not null default false,
  add column if not exists display_rank integer,
  add column if not exists last_evaluated_at timestamptz,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivation_reason text,
  add column if not exists match_confidence text;

alter table public.recommendations
  drop constraint if exists recommendations_display_rank_check,
  add constraint recommendations_display_rank_check check (display_rank is null or display_rank > 0),
  drop constraint if exists recommendations_match_confidence_check,
  add constraint recommendations_match_confidence_check check (match_confidence is null or match_confidence = any (array['Low'::text,'Medium'::text,'High'::text]));

create index if not exists recommendations_ai_active_idx
  on public.recommendations(user_id, is_active, frontend_featured, display_rank)
  where is_active = true;

create unique index if not exists recommendations_one_active_per_book_idx
  on public.recommendations(user_id, book_id)
  where is_active = true;

create or replace view public.v_ai_recommendations
with (security_invoker = true)
as
select
  r.id as recommendation_id,
  r.user_id,
  r.book_id as id,
  r.date_recommended,
  r.recommendation_strength,
  r.match_score_10,
  r.match_confidence,
  r.priority,
  r.recommendation_status,
  r.why_recommended,
  r.key_themes,
  r.similar_to,
  r.frontend_featured,
  r.frontend_shelf,
  r.user_interest,
  r.display_rank,
  r.last_evaluated_at,
  b.title,
  b.subtitle,
  coalesce(string_agg(distinct a.name, ', ' order by a.name) filter (where a.name is not null), '') as authors,
  b.original_publication_year,
  b.fiction_nonfiction,
  b.primary_genre,
  b.themes_tags,
  b.synopsis,
  coalesce(e.cover_url, b.cover_url_preferred) as cover_url,
  e.page_count,
  e.id as display_edition_id,
  e.isbn10,
  e.isbn13,
  e.publisher,
  e.publication_year as edition_year
from public.recommendations r
join public.books b on b.id = r.book_id
left join public.book_authors ba on ba.book_id = b.id
left join public.authors a on a.id = ba.author_id
left join public.editions e on e.id = b.reference_edition_id
where r.user_id = (select auth.uid())
  and r.is_active = true
  and coalesce(r.recommendation_status, 'New') in ('New','Shortlisted')
  and not exists (
    select 1 from public.library_entries le where le.book_id = r.book_id
  )
group by r.id, b.id, e.id;

grant select on public.v_ai_recommendations to authenticated;

create or replace function public.recommendation_add_to_wishlist(p_recommendation_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_rec public.recommendations%rowtype;
  v_entry_id uuid;
  v_existing_status text;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;

  select * into v_rec
  from public.recommendations
  where id = p_recommendation_id and user_id = v_uid;

  if not found then raise exception 'Recommendation not found'; end if;

  select overall_status into v_existing_status
  from public.library_entries
  where book_id = v_rec.book_id;

  if v_existing_status is null then
    insert into public.library_entries(
      user_id, book_id, overall_status, ownership_status, source, added_at, updated_at
    ) values (
      v_uid, v_rec.book_id, 'Wishlist', 'Not Owned', 'AI Recommendation', now(), now()
    ) returning id into v_entry_id;
  else
    update public.library_entries
      set overall_status = case when overall_status = 'Recommended' then 'Wishlist' else overall_status end,
          updated_at = now()
      where book_id = v_rec.book_id
      returning id into v_entry_id;
  end if;

  update public.recommendations
    set recommendation_status = case when coalesce(v_existing_status, 'Recommended') in ('Recommended','Wishlist') then 'Wishlist' else recommendation_status end,
        is_active = false,
        frontend_featured = false,
        deactivated_at = now(),
        deactivation_reason = case when coalesce(v_existing_status, 'Recommended') in ('Recommended','Wishlist') then 'Added to wishlist' else 'Already present in library' end,
        updated_at = now()
    where id = p_recommendation_id and user_id = v_uid;

  insert into public.library_events(user_id, book_id, event_type, source, payload)
  values (
    v_uid,
    v_rec.book_id,
    'wishlist_added_from_recommendation',
    'frontend',
    jsonb_build_object('recommendation_id', p_recommendation_id, 'match_score_10', v_rec.match_score_10, 'recommendation_strength', v_rec.recommendation_strength)
  );

  return v_entry_id;
end;
$function$;

grant execute on function public.recommendation_add_to_wishlist(uuid) to authenticated;
