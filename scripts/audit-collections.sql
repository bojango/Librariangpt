-- Read-only. Export result to an ignored/private JSON file, not a public log.
-- Read in a repeatable-read transaction when used with a direct connection.
select jsonb_build_object(
 'books',(select jsonb_agg(jsonb_build_object(
   'id',b.id,'title',b.title,'original_publication_year',b.original_publication_year,'cover_url_preferred',b.cover_url_preferred,
   'fiction_nonfiction',b.fiction_nonfiction,'primary_genre',b.primary_genre,
   'authors',coalesce((select string_agg(a.name,', ' order by ba.author_order) from public.book_authors ba join public.authors a on a.id=ba.author_id where ba.book_id=b.id),''),
   'in_library',exists(select 1 from public.library_entries l where l.book_id=b.id),
   'library_entry',(select jsonb_build_object('overall_status',l.overall_status,'ownership_status',l.ownership_status) from public.library_entries l where l.book_id=b.id),
   'editions',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'isbn13',e.isbn13,'isbn10',e.isbn10,'open_library_work_id',e.open_library_work_id,'open_library_edition_id',e.open_library_edition_id,'google_books_volume_id',e.google_books_volume_id,'metadata_payload',e.metadata_payload)) from public.editions e where e.book_id=b.id),'[]'::jsonb),
   'external_ids',coalesce((select jsonb_agg(jsonb_build_object('provider',e.provider,'external_id',e.external_id,'url',e.url)) from public.book_external_ids e where e.book_id=b.id),'[]'::jsonb)
 ) order by b.id) from public.books b),
 'series',coalesce((select jsonb_agg(s order by s.id) from public.series s),'[]'::jsonb),
 'book_series',coalesce((select jsonb_agg(s order by s.book_id,s.series_id) from public.book_series s),'[]'::jsonb)
) audit;
