-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace view public.v_library with (security_invoker = true) as
select
  b.id,
  b.legacy_id,
  b.title,
  b.subtitle,
  coalesce(string_agg(distinct a.name, ', ' order by a.name) filter (where a.name is not null), '') as authors,
  max(s.name) as series,
  max(bs.series_order) as series_order,
  b.original_publication_year,
  b.fiction_nonfiction,
  b.primary_genre,
  b.themes_tags,
  b.language,
  b.synopsis,
  l.overall_status,
  l.ownership_status,
  l.reading_priority,
  l.current_edition_id,
  b.reference_edition_id,
  e.id as display_edition_id,
  l.current_page,
  coalesce(l.total_pages, e.page_count) as total_pages,
  case when l.current_page is not null and coalesce(l.total_pages,e.page_count) is not null and coalesce(l.total_pages,e.page_count)>0
    then round((l.current_page::numeric/coalesce(l.total_pages,e.page_count)::numeric)*100,1) end as progress_percent,
  l.started_at,
  l.completed_at,
  l.user_rating_5,
  l.user_review,
  coalesce(e.cover_url,b.cover_url_preferred) as cover_url,
  e.format as edition_format,
  e.binding,
  e.publisher,
  e.imprint,
  e.publication_year as edition_year,
  e.publication_date as edition_date,
  e.isbn10,
  e.isbn13,
  e.page_count as edition_page_count,
  e.open_library_edition_id,
  e.open_library_work_id,
  e.google_books_volume_id,
  e.metadata_source as edition_metadata_source,
  e.metadata_last_fetched_at,
  e.metadata_match_confidence,
  e.signed,
  e.inscription,
  e.physical_dimensions,
  b.notes,
  coalesce(e.cover_source,b.cover_source) as cover_source,
  coalesce(e.cover_verified,b.cover_verified,false) as cover_verified
from public.books b
join public.library_entries l on l.book_id=b.id
left join public.book_authors ba on ba.book_id=b.id
left join public.authors a on a.id=ba.author_id
left join public.book_series bs on bs.book_id=b.id
left join public.series s on s.id=bs.series_id
left join public.editions e on e.id=coalesce(l.current_edition_id,b.reference_edition_id)
group by b.id,l.id,e.id;
