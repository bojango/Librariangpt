-- Read-only audit executed on 2026-10-09. Counts, not repair commands.
select s.session_code,e.type,count(*) as occurrences,min(e.occurred_at) as first_seen,max(e.occurred_at) as last_seen from diagnostic_events e join diagnostic_sessions s on s.id=e.session_id where s.session_code='6NVNDL' and e.type='unhandled_rejection' and e.payload::text like '%Choose an edition before uploading a cover.%' group by s.session_code,e.type;
-- Additional RPC/security, enrichment, cover, Up Next and timing checks:
select jsonb_build_object(
'legacy_bridge', (select jsonb_build_object('signature',p.oid::regprocedure::text,'security_definer',p.prosecdef,'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'definition',pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='record_reading_checkin_bridge'),
'stale_editions',(select jsonb_agg(jsonb_build_object('title',title,'last_refreshed_at',editions_last_refreshed_at)) from books where editions_status='refreshing' and (editions_last_refreshed_at is null or editions_last_refreshed_at<now()-interval '15 minutes')),
'job_statuses',(select jsonb_object_agg(status,n) from (select status,count(*) n from book_enrichment_jobs group by status)x),
'stale_processing_jobs',(select count(*) from book_enrichment_jobs where status='processing' and locked_at<now()-interval '15 minutes'),
'overdue_queued_jobs',(select count(*) from book_enrichment_jobs where status='queued' and available_at<now()-interval '15 minutes'),
'nfc_negative_duration',(select count(*) from reading_time_sessions where ended_at<started_at),
'nfc_long_duration_review',(select count(*) from reading_time_sessions where ended_at-started_at>interval '24 hours'),
'nfc_submitted_without_end',(select count(*) from reading_time_sessions where progress_state='submitted' and (ended_at is null or end_page is null or progress_submitted_at is null)),
'nfc_page_regression_review',(select count(*) from reading_time_sessions where end_page<start_page),
'book_locked_without_cover',(select count(*) from books where cover_locked and nullif(cover_url_preferred,'') is null),
'uploaded_edition_unlocked',(select count(*) from editions where cover_uploaded_by_user and not cover_locked),
'multiple_selected_cover',(select count(*) from (select book_id from book_cover_candidates where selected group by book_id having count(*)>1)x),
'upnext_duplicate_book',(select count(*) from (select user_id,book_id from up_next_queue group by 1,2 having count(*)>1)x),
'upnext_duplicate_position',(select count(*) from (select user_id,position from up_next_queue group by 1,2 having count(*)>1)x),
'upnext_ineligible',(select count(*) from up_next_queue q join library_entries l on l.user_id=q.user_id and l.book_id=q.book_id where l.overall_status not in ('Owned - Unread','Wishlist','Recommended','Paused')),
'implausible_editions',(select jsonb_agg(jsonb_build_object('title',b.title,'edition_id',e.id,'isbn13',e.isbn13,'pages',e.page_count,'metadata_source',e.metadata_source)) from editions e join books b on b.id=e.book_id where page_count>10000)
) as evidence;

-- ISBN-10/13 should represent the same edition, not merely the same work.
select b.title,e.id,e.isbn10,e.isbn13,e.identity_locked,e.exact_copy_verified
from editions e join books b on b.id=e.book_id
where e.isbn10 is not null and e.isbn13 like '978%'
and substring(regexp_replace(e.isbn13,'[^0-9]','','g'),4,9)<>left(regexp_replace(e.isbn10,'[^0-9Xx]','','g'),9);
select 'cross_book_current_edition' issue,count(*) n from library_entries l join editions e on e.id=l.current_edition_id where e.book_id<>l.book_id
union all select 'cross_book_reference',count(*) from books b join editions e on e.id=b.reference_edition_id where e.book_id<>b.id
union all select 'cross_book_session_edition',count(*) from reading_sessions s join editions e on e.id=s.edition_id where e.book_id<>s.book_id
union all select 'invalid_library_pages',count(*) from library_entries where current_page<0 or total_pages<=0 or current_page>total_pages
union all select 'invalid_session_pages',count(*) from reading_sessions where current_page<0 or total_pages<=0 or current_page>total_pages
union all select 'invalid_progress',count(*) from progress_logs where page<0 or progress_percent<0 or progress_percent>100 or page>total_pages_snapshot
union all select 'progress_session_mismatch',count(*) from progress_logs p join reading_sessions s on s.id=p.session_id where p.book_id<>s.book_id or p.user_id<>s.user_id
union all select 'feedback_session_mismatch',count(*) from reading_feedback p join reading_sessions s on s.id=p.session_id where p.book_id<>s.book_id or p.user_id<>s.user_id
union all select 'notes_session_mismatch',count(*) from reading_card_notes p join reading_sessions s on s.id=p.session_id where p.book_id<>s.book_id or p.user_id<>s.user_id
union all select 'invalid_dates',count(*) from reading_sessions where completed_at<started_at
union all select 'invalid_nfc_dates',count(*) from reading_time_sessions where ended_at<started_at
union all select 'nfc_reading_mismatch',count(*) from reading_time_sessions p join reading_sessions s on s.id=p.reading_session_id where p.book_id<>s.book_id or p.user_id<>s.user_id
union all select 'nfc_duplicate_open',count(*) from (select user_id,bookmark_id from reading_time_sessions where ended_at is null group by 1,2 having count(*)>1) d
union all select 'duplicate_editions_isbn',count(*) from (select book_id,regexp_replace(coalesce(isbn13,isbn10),'[^0-9X]','','g') from editions where coalesce(isbn13,isbn10) is not null group by 1,2 having count(*)>1) d
union all select 'duplicate_library',count(*) from (select user_id,book_id from library_entries group by 1,2 having count(*)>1) d;

select 'cross_book_cover_candidate' issue,count(*) n from book_cover_candidates c join editions e on e.id=c.edition_id where c.book_id<>e.book_id
union all select 'cross_book_quote_edition',count(*) from book_quotes c join editions e on e.id=c.edition_id where c.book_id<>e.book_id
union all select 'quote_session_mismatch',count(*) from book_quotes c join reading_sessions s on s.id=c.session_id where c.book_id<>s.book_id or c.user_id<>s.user_id
union all select 'diagnostic_owner_mismatch',count(*) from diagnostic_events e join diagnostic_sessions s on s.id=e.session_id where e.user_id<>s.user_id
union all select 'nfc_invalid_pages',count(*) from reading_time_sessions where start_page<0 or end_page<0
union all select 'isbn13_invalid_shape',count(*) from editions where isbn13 is not null and regexp_replace(isbn13,'[^0-9]','','g')!~'^(978|979)[0-9]{10}$'
union all select 'isbn13_invalid_checksum',count(*) from editions where isbn13 ~ '^[0-9]{13}$' and (select sum(substring(isbn13,i,1)::int*case when i%2=0 then 3 else 1 end) from generate_series(1,13)i)%10<>0
union all select 'invalid_edition_pages',count(*) from editions where page_count<=0 or page_count>10000
union all select 'duplicate_active_recommendations',count(*) from (select user_id,book_id from recommendations where is_active group by 1,2 having count(*)>1)d
union all select 'owned_wishlist',count(*) from library_entries where ownership_status='Owned' and overall_status='Wishlist'
union all select 'completed_without_date',count(*) from library_entries where overall_status='Read' and completed_at is null
union all select 'duplicate_title_author',count(*) from (select title,authors from v_library group by title,authors having count(*)>1)d
union all select 'missing_stored_cover_object',count(*) from books b where b.cover_url_preferred like '%/storage/v1/object/public/book-covers/%' and not exists(select 1 from storage.objects o where o.bucket_id='book-covers' and o.name=split_part(split_part(b.cover_url_preferred,'/book-covers/',2),'?',1));

select 'book_authors_book_id_fkey' issue,count(*) n from "public"."book_authors" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'book_authors_author_id_fkey' issue,count(*) n from "public"."book_authors" s where s."author_id" is not null and not exists(select 1 from "public"."authors" t where s."author_id"=t."id")
union all
select 'book_series_book_id_fkey' issue,count(*) n from "public"."book_series" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'book_series_series_id_fkey' issue,count(*) n from "public"."book_series" s where s."series_id" is not null and not exists(select 1 from "public"."series" t where s."series_id"=t."id")
union all
select 'editions_book_id_fkey' issue,count(*) n from "public"."editions" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'library_entries_user_id_fkey' issue,count(*) n from "public"."library_entries" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'library_entries_book_id_fkey' issue,count(*) n from "public"."library_entries" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'library_entries_current_edition_id_fkey' issue,count(*) n from "public"."library_entries" s where s."current_edition_id" is not null and not exists(select 1 from "public"."editions" t where s."current_edition_id"=t."id")
union all
select 'reading_sessions_user_id_fkey' issue,count(*) n from "public"."reading_sessions" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'reading_sessions_book_id_fkey' issue,count(*) n from "public"."reading_sessions" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'reading_sessions_edition_id_fkey' issue,count(*) n from "public"."reading_sessions" s where s."edition_id" is not null and not exists(select 1 from "public"."editions" t where s."edition_id"=t."id")
union all
select 'progress_logs_user_id_fkey' issue,count(*) n from "public"."progress_logs" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'progress_logs_session_id_fkey' issue,count(*) n from "public"."progress_logs" s where s."session_id" is not null and not exists(select 1 from "public"."reading_sessions" t where s."session_id"=t."id")
union all
select 'progress_logs_book_id_fkey' issue,count(*) n from "public"."progress_logs" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'recommendations_user_id_fkey' issue,count(*) n from "public"."recommendations" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'recommendations_book_id_fkey' issue,count(*) n from "public"."recommendations" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'reading_feedback_user_id_fkey' issue,count(*) n from "public"."reading_feedback" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'reading_feedback_book_id_fkey' issue,count(*) n from "public"."reading_feedback" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'reading_feedback_session_id_fkey' issue,count(*) n from "public"."reading_feedback" s where s."session_id" is not null and not exists(select 1 from "public"."reading_sessions" t where s."session_id"=t."id")
union all
select 'taste_profile_user_id_fkey' issue,count(*) n from "public"."taste_profile" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'taste_evidence_taste_profile_id_fkey' issue,count(*) n from "public"."taste_evidence" s where s."taste_profile_id" is not null and not exists(select 1 from "public"."taste_profile" t where s."taste_profile_id"=t."id")
union all
select 'taste_evidence_feedback_id_fkey' issue,count(*) n from "public"."taste_evidence" s where s."feedback_id" is not null and not exists(select 1 from "public"."reading_feedback" t where s."feedback_id"=t."id")
union all
select 'taste_evidence_book_id_fkey' issue,count(*) n from "public"."taste_evidence" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'book_external_ids_book_id_fkey' issue,count(*) n from "public"."book_external_ids" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'library_events_user_id_fkey' issue,count(*) n from "public"."library_events" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'library_events_book_id_fkey' issue,count(*) n from "public"."library_events" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'library_events_session_id_fkey' issue,count(*) n from "public"."library_events" s where s."session_id" is not null and not exists(select 1 from "public"."reading_sessions" t where s."session_id"=t."id")
union all
select 'books_reference_edition_id_fkey' issue,count(*) n from "public"."books" s where s."reference_edition_id" is not null and not exists(select 1 from "public"."editions" t where s."reference_edition_id"=t."id")
union all
select 'public_ratings_book_id_fkey' issue,count(*) n from "public"."public_ratings" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'book_cover_candidates_book_id_fkey' issue,count(*) n from "public"."book_cover_candidates" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'book_cover_candidates_edition_id_fkey' issue,count(*) n from "public"."book_cover_candidates" s where s."edition_id" is not null and not exists(select 1 from "public"."editions" t where s."edition_id"=t."id")
union all
select 'edition_chapters_edition_id_fkey' issue,count(*) n from "public"."edition_chapters" s where s."edition_id" is not null and not exists(select 1 from "public"."editions" t where s."edition_id"=t."id")
union all
select 'book_metadata_candidates_book_id_fkey' issue,count(*) n from "public"."book_metadata_candidates" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'up_next_queue_user_id_fkey' issue,count(*) n from "public"."up_next_queue" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'up_next_queue_book_id_fkey' issue,count(*) n from "public"."up_next_queue" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'book_quotes_book_id_fkey' issue,count(*) n from "public"."book_quotes" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'book_quotes_edition_id_fkey' issue,count(*) n from "public"."book_quotes" s where s."edition_id" is not null and not exists(select 1 from "public"."editions" t where s."edition_id"=t."id")
union all
select 'book_quotes_session_id_fkey' issue,count(*) n from "public"."book_quotes" s where s."session_id" is not null and not exists(select 1 from "public"."reading_sessions" t where s."session_id"=t."id")
union all
select 'diagnostic_sessions_user_id_fkey' issue,count(*) n from "public"."diagnostic_sessions" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'diagnostic_events_session_id_fkey' issue,count(*) n from "public"."diagnostic_events" s where s."session_id" is not null and not exists(select 1 from "public"."diagnostic_sessions" t where s."session_id"=t."id")
union all
select 'diagnostic_events_user_id_fkey' issue,count(*) n from "public"."diagnostic_events" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'reading_card_notes_user_id_fkey' issue,count(*) n from "public"."reading_card_notes" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'reading_card_notes_book_id_fkey' issue,count(*) n from "public"."reading_card_notes" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'reading_card_notes_session_id_fkey' issue,count(*) n from "public"."reading_card_notes" s where s."session_id" is not null and not exists(select 1 from "public"."reading_sessions" t where s."session_id"=t."id")
union all
select 'reading_card_notes_progress_log_id_fkey' issue,count(*) n from "public"."reading_card_notes" s where s."progress_log_id" is not null and not exists(select 1 from "public"."progress_logs" t where s."progress_log_id"=t."id")
union all
select 'rating_refresh_state_book_id_fkey' issue,count(*) n from "public"."rating_refresh_state" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'book_accolades_book_id_fkey' issue,count(*) n from "public"."book_accolades" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'book_accolades_accolade_id_fkey' issue,count(*) n from "public"."book_accolades" s where s."accolade_id" is not null and not exists(select 1 from "public"."accolades" t where s."accolade_id"=t."id")
union all
select 'reader_profiles_user_id_fkey' issue,count(*) n from "public"."reader_profiles" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'reader_ui_preferences_user_id_fkey' issue,count(*) n from "public"."reader_ui_preferences" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'book_enrichment_jobs_book_id_fkey' issue,count(*) n from "public"."book_enrichment_jobs" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'next_read_intents_user_id_fkey' issue,count(*) n from "public"."next_read_intents" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'next_read_intents_source_session_id_fkey' issue,count(*) n from "public"."next_read_intents" s where s."source_session_id" is not null and not exists(select 1 from "public"."reading_sessions" t where s."source_session_id"=t."id")
union all
select 'next_read_intents_source_book_id_fkey' issue,count(*) n from "public"."next_read_intents" s where s."source_book_id" is not null and not exists(select 1 from "public"."books" t where s."source_book_id"=t."id")
union all
select 'next_read_transitions_user_id_fkey' issue,count(*) n from "public"."next_read_transitions" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'next_read_transitions_session_id_fkey' issue,count(*) n from "public"."next_read_transitions" s where s."session_id" is not null and not exists(select 1 from "public"."reading_sessions" t where s."session_id"=t."id")
union all
select 'up_next_planner_state_user_id_fkey' issue,count(*) n from "public"."up_next_planner_state" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'up_next_refreshes_user_id_fkey' issue,count(*) n from "public"."up_next_refreshes" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'up_next_exclusions_user_id_fkey' issue,count(*) n from "public"."up_next_exclusions" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'up_next_exclusions_book_id_fkey' issue,count(*) n from "public"."up_next_exclusions" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'nfc_bookmarks_user_id_fkey' issue,count(*) n from "public"."nfc_bookmarks" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'nfc_bookmarks_pinned_book_id_fkey' issue,count(*) n from "public"."nfc_bookmarks" s where s."pinned_book_id" is not null and not exists(select 1 from "public"."books" t where s."pinned_book_id"=t."id")
union all
select 'reading_time_sessions_user_id_fkey' issue,count(*) n from "public"."reading_time_sessions" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'reading_time_sessions_book_id_fkey' issue,count(*) n from "public"."reading_time_sessions" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id")
union all
select 'reading_time_sessions_edition_id_fkey' issue,count(*) n from "public"."reading_time_sessions" s where s."edition_id" is not null and not exists(select 1 from "public"."editions" t where s."edition_id"=t."id")
union all
select 'reading_time_sessions_reading_session_id_fkey' issue,count(*) n from "public"."reading_time_sessions" s where s."reading_session_id" is not null and not exists(select 1 from "public"."reading_sessions" t where s."reading_session_id"=t."id")
union all
select 'reading_time_sessions_bookmark_id_user_id_fkey' issue,count(*) n from "public"."reading_time_sessions" s where s."bookmark_id" is not null and s."user_id" is not null and not exists(select 1 from "public"."nfc_bookmarks" t where s."bookmark_id"=t."id" and s."user_id"=t."user_id")
union all
select 'nfc_bookmarks_active_book_id_fkey' issue,count(*) n from "public"."nfc_bookmarks" s where s."active_book_id" is not null and not exists(select 1 from "public"."books" t where s."active_book_id"=t."id")
union all
select 'nfc_pending_starts_user_id_fkey' issue,count(*) n from "public"."nfc_pending_starts" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'nfc_pending_starts_bookmark_id_user_id_fkey' issue,count(*) n from "public"."nfc_pending_starts" s where s."bookmark_id" is not null and s."user_id" is not null and not exists(select 1 from "public"."nfc_bookmarks" t where s."bookmark_id"=t."id" and s."user_id"=t."user_id")
union all
select 'app_navigation_requests_user_id_fkey' issue,count(*) n from "public"."app_navigation_requests" s where s."user_id" is not null and not exists(select 1 from "auth"."users" t where s."user_id"=t."id")
union all
select 'app_navigation_requests_book_id_fkey' issue,count(*) n from "public"."app_navigation_requests" s where s."book_id" is not null and not exists(select 1 from "public"."books" t where s."book_id"=t."id");
