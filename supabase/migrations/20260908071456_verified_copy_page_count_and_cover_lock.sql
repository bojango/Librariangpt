-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

alter table public.editions
  add column if not exists page_count_verified boolean not null default false,
  add column if not exists page_count_verification_source text;

create or replace function public.set_book_page_count(p_book_id uuid,p_total_pages integer,p_source text default 'frontend') returns jsonb
language plpgsql set search_path=''
as $$
declare v_uid uuid := (select auth.uid()); v_edition uuid; v_current_page integer;
begin
 if not private.is_owner() then raise exception 'Not authorized'; end if;
 if p_total_pages is null or p_total_pages<1 then raise exception 'Total pages must be positive'; end if;
 select current_edition_id,current_page into v_edition,v_current_page from public.library_entries where user_id=v_uid and book_id=p_book_id;
 if not found then raise exception 'Book not found in library'; end if;
 if v_current_page is not null and v_current_page>p_total_pages then raise exception 'Total pages cannot be below current page'; end if;
 update public.library_entries set total_pages=p_total_pages,updated_at=now() where user_id=v_uid and book_id=p_book_id;
 update public.reading_sessions set total_pages=p_total_pages,updated_at=now() where user_id=v_uid and book_id=p_book_id and status in ('Reading','Paused');
 if v_edition is not null then update public.editions set page_count=p_total_pages,page_count_verified=true,page_count_verification_source=p_source,identity_locked=true,updated_at=now() where id=v_edition; end if;
 insert into public.library_events(user_id,book_id,event_type,source,payload) values(v_uid,p_book_id,'page_count_corrected',p_source,jsonb_build_object('total_pages',p_total_pages,'verified',true));
 return jsonb_build_object('saved',true,'total_pages',p_total_pages,'page_count_verified',true);
end;$$;

create or replace function public.set_reading_page_count(p_book_id uuid,p_total_pages integer,p_source text default 'frontend') returns jsonb
language plpgsql set search_path=''
as $$
declare v_uid uuid := (select auth.uid()); v_session uuid; v_edition uuid; v_page integer;
begin
 if not private.is_owner() then raise exception 'Not authorized'; end if;
 if p_total_pages is null or p_total_pages<1 then raise exception 'Total pages must be positive'; end if;
 select id,current_page,edition_id into v_session,v_page,v_edition from public.reading_sessions where user_id=v_uid and book_id=p_book_id and status in ('Reading','Paused') order by started_at desc nulls last,created_at desc limit 1;
 if v_session is null then raise exception 'No active or paused reading session'; end if;
 if v_page is not null and v_page>p_total_pages then raise exception 'Total pages cannot be below current page'; end if;
 update public.reading_sessions set total_pages=p_total_pages,updated_at=now() where id=v_session;
 update public.library_entries set total_pages=p_total_pages,updated_at=now() where user_id=v_uid and book_id=p_book_id;
 if v_edition is not null then update public.editions set page_count=p_total_pages,page_count_verified=true,page_count_verification_source=p_source,identity_locked=true,updated_at=now() where id=v_edition; end if;
 insert into public.library_events(user_id,book_id,session_id,event_type,source,payload) values(v_uid,p_book_id,v_session,'page_count_set',p_source,jsonb_build_object('total_pages',p_total_pages,'verified',true));
 return jsonb_build_object('total_pages',p_total_pages,'session_id',v_session,'page_count_verified',true);
end;$$;

create or replace function public.verify_owned_edition(p_book_id uuid,p_edition_id uuid,p_source text default 'frontend') returns jsonb
language plpgsql set search_path=''
as $$
declare v_uid uuid := (select auth.uid()); v_pages integer; v_cover text; v_status text;
begin
 if not private.is_owner() then raise exception 'Not authorized'; end if;
 select e.page_count,e.cover_url into v_pages,v_cover from public.editions e where e.id=p_edition_id and e.book_id=p_book_id;
 if not found then raise exception 'Edition does not belong to this book'; end if;
 select le.overall_status into v_status from public.library_entries le where le.user_id=v_uid and le.book_id=p_book_id;
 if not found then raise exception 'Book not found in library'; end if;
 update public.editions set preferred_copy=false,updated_at=now() where book_id=p_book_id and id<>p_edition_id and preferred_copy=true;
 update public.editions set owned=true,preferred_copy=true,is_reference=false,exact_copy_verified=true,exact_copy_verified_at=now(),exact_copy_verification_source=p_source,identity_locked=true,cover_locked=true,updated_at=now() where id=p_edition_id;
 update public.books set cover_url_preferred=v_cover,cover_locked=true,updated_at=now() where id=p_book_id;
 update public.library_entries set ownership_status='Owned',overall_status=case when overall_status in ('Recommended','Wishlist') then 'Owned - Unread' else overall_status end,current_edition_id=p_edition_id,total_pages=coalesce(v_pages,total_pages),updated_at=now() where user_id=v_uid and book_id=p_book_id;
 insert into public.library_events(user_id,book_id,event_type,source,payload) values(v_uid,p_book_id,'exact_copy_verified',p_source,jsonb_build_object('edition_id',p_edition_id,'page_count',v_pages,'page_count_verified',(select page_count_verified from public.editions where id=p_edition_id)));
 return jsonb_build_object('saved',true,'book_id',p_book_id,'edition_id',p_edition_id,'page_count',v_pages,'exact_copy_verified',true);
end;$$;

create or replace view public.v_library as
select b.id,b.legacy_id,b.title,b.subtitle,
coalesce(string_agg(distinct a.name, ', ' order by a.name) filter(where a.name is not null),'') as authors,
max(s.name) as series,max(bs.series_order) as series_order,b.original_publication_year,b.fiction_nonfiction,b.primary_genre,b.themes_tags,b.language,b.synopsis,
l.overall_status,l.ownership_status,l.reading_priority,l.current_edition_id,b.reference_edition_id,e.id as display_edition_id,l.current_page,coalesce(l.total_pages,e.page_count) as total_pages,
case when l.current_page is not null and coalesce(l.total_pages,e.page_count) is not null and coalesce(l.total_pages,e.page_count)>0 then round(l.current_page::numeric/coalesce(l.total_pages,e.page_count)::numeric*100,1) else null end as progress_percent,
l.started_at,l.completed_at,l.user_rating_5,l.user_review,l.review_notes,l.reviewed_at,coalesce(e.cover_url,b.cover_url_preferred) as cover_url,e.cover_source,e.cover_verified,e.format as edition_format,e.binding,e.publisher,e.imprint,e.publication_year as edition_year,e.publication_date as edition_date,e.edition_statement,e.printing_impression,e.number_line,e.country,e.condition,e.isbn10,e.isbn13,e.page_count as edition_page_count,e.open_library_edition_id,e.open_library_work_id,e.google_books_volume_id,e.metadata_source as edition_metadata_source,e.metadata_last_fetched_at,e.metadata_match_confidence,e.signed,e.inscription,e.physical_dimensions,pr.provider as public_rating_provider,pr.rating_5 as public_rating_5,pr.rating_count as public_rating_count,pr.review_count as public_review_count,pr.source_url as public_rating_url,pr.fetched_at as public_rating_fetched_at,b.notes,
e.cover_locked,e.cover_uploaded_by_user,e.exact_copy_verified,e.exact_copy_verified_at,e.exact_copy_verification_source,e.identity_locked,e.page_count_verified,e.page_count_verification_source
from public.books b join public.library_entries l on l.book_id=b.id
left join public.book_authors ba on ba.book_id=b.id left join public.authors a on a.id=ba.author_id left join public.book_series bs on bs.book_id=b.id left join public.series s on s.id=bs.series_id left join public.editions e on e.id=coalesce(l.current_edition_id,b.reference_edition_id)
left join lateral (select x.* from public.public_ratings x where x.book_id=b.id order by x.is_primary desc,case lower(x.provider) when 'goodreads' then 1 when 'google books' then 2 when 'open library' then 3 else 9 end,x.fetched_at desc limit 1) pr on true
group by b.id,l.id,e.id,pr.id,pr.provider,pr.rating_5,pr.rating_count,pr.review_count,pr.source_url,pr.fetched_at;
