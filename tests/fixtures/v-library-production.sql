-- Read-only production definition captured 2026-10-09, for isolated SQL compatibility tests.
create or replace view public.v_library with (security_invoker=true) as
 SELECT b.id,
    b.legacy_id,
    b.title,
    b.subtitle,
    COALESCE(string_agg(DISTINCT a.name, ', '::text ORDER BY a.name) FILTER (WHERE a.name IS NOT NULL), ''::text) AS authors,
    max(s.name) AS series,
    max(bs.series_order) AS series_order,
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
    e.id AS display_edition_id,
    l.current_page,
    COALESCE(l.total_pages, e.page_count) AS total_pages,
        CASE
            WHEN l.current_page IS NOT NULL AND COALESCE(l.total_pages, e.page_count) IS NOT NULL AND COALESCE(l.total_pages, e.page_count) > 0 THEN round(l.current_page::numeric / COALESCE(l.total_pages, e.page_count)::numeric * 100::numeric, 1)
            ELSE NULL::numeric
        END AS progress_percent,
    l.started_at,
    l.completed_at,
    l.user_rating_5,
    l.user_review,
    l.review_notes,
    l.reviewed_at,
    COALESCE(e.cover_url, b.cover_url_preferred) AS cover_url,
    e.cover_source,
    e.cover_verified,
    e.format AS edition_format,
    e.binding,
    e.publisher,
    e.imprint,
    e.publication_year AS edition_year,
    e.publication_date AS edition_date,
    e.edition_statement,
    e.printing_impression,
    e.number_line,
    e.country,
    e.condition,
    e.isbn10,
    e.isbn13,
    e.page_count AS edition_page_count,
    e.open_library_edition_id,
    e.open_library_work_id,
    e.google_books_volume_id,
    e.metadata_source AS edition_metadata_source,
    e.metadata_last_fetched_at,
    e.metadata_match_confidence,
    e.signed,
    e.inscription,
    e.physical_dimensions,
    pr.provider AS public_rating_provider,
    pr.rating_5 AS public_rating_5,
    pr.rating_count AS public_rating_count,
    pr.review_count AS public_review_count,
    pr.source_url AS public_rating_url,
    pr.fetched_at AS public_rating_fetched_at,
    b.notes,
    e.cover_locked,
    e.cover_uploaded_by_user,
    e.exact_copy_verified,
    e.exact_copy_verified_at,
    e.exact_copy_verification_source,
    e.identity_locked,
    e.page_count_verified,
    e.page_count_verification_source
   FROM books b
     JOIN library_entries l ON l.book_id = b.id
     LEFT JOIN book_authors ba ON ba.book_id = b.id
     LEFT JOIN authors a ON a.id = ba.author_id
     LEFT JOIN book_series bs ON bs.book_id = b.id
     LEFT JOIN series s ON s.id = bs.series_id
     LEFT JOIN editions e ON e.id = COALESCE(l.current_edition_id, b.reference_edition_id)
     LEFT JOIN LATERAL ( SELECT x.id,
            x.book_id,
            x.provider,
            x.rating_5,
            x.rating_count,
            x.review_count,
            x.source_url,
            x.provider_book_id,
            x.is_primary,
            x.fetched_at,
            x.notes,
            x.created_at,
            x.updated_at
           FROM public_ratings x
          WHERE x.book_id = b.id AND lower(x.provider) = 'goodreads'::text
          ORDER BY x.fetched_at DESC
         LIMIT 1) pr ON true
  GROUP BY b.id, l.id, e.id, pr.id, pr.provider, pr.rating_5, pr.rating_count, pr.review_count, pr.source_url, pr.fetched_at;
