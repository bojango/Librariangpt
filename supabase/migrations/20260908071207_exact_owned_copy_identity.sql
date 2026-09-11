-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

alter table public.editions
  add column if not exists exact_copy_verified boolean not null default false,
  add column if not exists exact_copy_verified_at timestamptz,
  add column if not exists exact_copy_verification_source text,
  add column if not exists identity_locked boolean not null default false,
  add column if not exists cover_uploaded_by_user boolean not null default false;

create or replace function public.verify_owned_edition(
  p_book_id uuid,
  p_edition_id uuid,
  p_source text default 'frontend'
) returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pages integer;
  v_status text;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  select e.page_count into v_pages from public.editions e where e.id=p_edition_id and e.book_id=p_book_id;
  if not found then raise exception 'Edition does not belong to this book'; end if;
  select le.overall_status into v_status from public.library_entries le where le.user_id=v_uid and le.book_id=p_book_id;
  if not found then raise exception 'Book not found in library'; end if;
  update public.editions set preferred_copy=false, updated_at=now() where book_id=p_book_id and id<>p_edition_id and preferred_copy=true;
  update public.editions set owned=true,preferred_copy=true,is_reference=false,exact_copy_verified=true,exact_copy_verified_at=now(),exact_copy_verification_source=p_source,identity_locked=true,updated_at=now() where id=p_edition_id;
  update public.library_entries set ownership_status='Owned',overall_status=case when overall_status in ('Recommended','Wishlist') then 'Owned - Unread' else overall_status end,current_edition_id=p_edition_id,total_pages=coalesce(v_pages,total_pages),updated_at=now() where user_id=v_uid and book_id=p_book_id;
  insert into public.library_events(user_id,book_id,event_type,source,payload) values(v_uid,p_book_id,'exact_copy_verified',p_source,jsonb_build_object('edition_id',p_edition_id,'page_count',v_pages));
  return jsonb_build_object('saved',true,'book_id',p_book_id,'edition_id',p_edition_id,'page_count',v_pages,'exact_copy_verified',true);
end;
$$;
grant execute on function public.verify_owned_edition(uuid,uuid,text) to authenticated;

create or replace function public.select_book_edition(
  p_book_id uuid,
  p_edition_id uuid,
  p_mark_owned boolean default false,
  p_progress_mode text default 'page',
  p_source text default 'frontend'
) returns jsonb
language plpgsql
set search_path=''
as $$
declare
  v_uid uuid := (select auth.uid()); v_status text; v_ownership text; v_old_edition uuid; v_old_pages integer; v_old_page integer; v_new_pages integer; v_new_page integer; v_is_reading boolean := false;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_progress_mode not in ('page','percentage') then raise exception 'Invalid progress mode'; end if;
  select overall_status,ownership_status,current_edition_id,total_pages,current_page into v_status,v_ownership,v_old_edition,v_old_pages,v_old_page from public.library_entries where user_id=v_uid and book_id=p_book_id;
  if not found then raise exception 'Book not found in library'; end if;
  select page_count into v_new_pages from public.editions where id=p_edition_id and book_id=p_book_id;
  if not found then raise exception 'Edition does not belong to this book'; end if;
  v_is_reading := v_status in ('Currently Reading','Paused'); v_new_page := v_old_page;
  if v_is_reading and v_old_page is not null and v_new_pages is not null then
    if p_progress_mode='percentage' and coalesce(v_old_pages,0)>0 then v_new_page:=least(v_new_pages,greatest(0,round((v_old_page::numeric/v_old_pages::numeric)*v_new_pages)::integer)); else v_new_page:=least(v_old_page,v_new_pages); end if;
  end if;
  if p_mark_owned then
    update public.editions set preferred_copy=false,updated_at=now() where book_id=p_book_id and id<>p_edition_id and preferred_copy=true;
    update public.editions set owned=true,preferred_copy=true,is_reference=false,exact_copy_verified=true,exact_copy_verified_at=now(),exact_copy_verification_source=p_source,identity_locked=true,updated_at=now() where id=p_edition_id;
    update public.library_entries set ownership_status='Owned',overall_status=case when overall_status in ('Recommended','Wishlist') then 'Owned - Unread' else overall_status end,current_edition_id=p_edition_id,total_pages=coalesce(v_new_pages,total_pages),current_page=case when v_is_reading then v_new_page else current_page end,updated_at=now() where user_id=v_uid and book_id=p_book_id;
    update public.recommendations set recommendation_status='Acquired',updated_at=now() where user_id=v_uid and book_id=p_book_id and recommendation_status in ('New','Shortlisted','Wishlist');
  elsif v_is_reading or v_ownership in ('Owned','Borrowed','On Order') then
    update public.library_entries set current_edition_id=p_edition_id,total_pages=coalesce(v_new_pages,total_pages),current_page=case when v_is_reading then v_new_page else current_page end,updated_at=now() where user_id=v_uid and book_id=p_book_id;
  else
    update public.editions set is_reference=false,updated_at=now() where book_id=p_book_id and is_reference=true and id<>p_edition_id and coalesce(owned,false)=false;
    update public.editions set is_reference=true,updated_at=now() where id=p_edition_id;
    update public.books set reference_edition_id=p_edition_id,updated_at=now() where id=p_book_id;
    update public.library_entries set current_edition_id=null,total_pages=v_new_pages,updated_at=now() where user_id=v_uid and book_id=p_book_id;
  end if;
  if v_is_reading then update public.reading_sessions set edition_id=p_edition_id,total_pages=coalesce(v_new_pages,total_pages),current_page=coalesce(v_new_page,current_page),updated_at=now() where user_id=v_uid and book_id=p_book_id and status in ('Reading','Paused'); end if;
  insert into public.library_events(user_id,book_id,event_type,source,payload) values(v_uid,p_book_id,'edition_selected',p_source,jsonb_build_object('old_edition_id',v_old_edition,'edition_id',p_edition_id,'mark_owned',p_mark_owned,'progress_mode',p_progress_mode,'old_page',v_old_page,'new_page',v_new_page,'old_total_pages',v_old_pages,'new_total_pages',v_new_pages,'exact_copy_verified',p_mark_owned));
  return jsonb_build_object('saved',true,'edition_id',p_edition_id,'mark_owned',p_mark_owned,'current_page',v_new_page,'total_pages',v_new_pages,'overall_status',case when p_mark_owned and v_status in ('Recommended','Wishlist') then 'Owned - Unread' else v_status end,'exact_copy_verified',p_mark_owned);
end;
$$;

create or replace view public.v_library as
select b.id,b.legacy_id,b.title,b.subtitle,
coalesce(string_agg(distinct a.name, ', ' order by a.name) filter(where a.name is not null),'') as authors,
max(s.name) as series,max(bs.series_order) as series_order,b.original_publication_year,b.fiction_nonfiction,b.primary_genre,b.themes_tags,b.language,b.synopsis,
l.overall_status,l.ownership_status,l.reading_priority,l.current_edition_id,b.reference_edition_id,e.id as display_edition_id,l.current_page,coalesce(l.total_pages,e.page_count) as total_pages,
case when l.current_page is not null and coalesce(l.total_pages,e.page_count) is not null and coalesce(l.total_pages,e.page_count)>0 then round(l.current_page::numeric/coalesce(l.total_pages,e.page_count)::numeric*100,1) else null end as progress_percent,
l.started_at,l.completed_at,l.user_rating_5,l.user_review,l.review_notes,l.reviewed_at,coalesce(e.cover_url,b.cover_url_preferred) as cover_url,e.cover_source,e.cover_verified,e.format as edition_format,e.binding,e.publisher,e.imprint,e.publication_year as edition_year,e.publication_date as edition_date,e.edition_statement,e.printing_impression,e.number_line,e.country,e.condition,e.isbn10,e.isbn13,e.page_count as edition_page_count,e.open_library_edition_id,e.open_library_work_id,e.google_books_volume_id,e.metadata_source as edition_metadata_source,e.metadata_last_fetched_at,e.metadata_match_confidence,e.signed,e.inscription,e.physical_dimensions,pr.provider as public_rating_provider,pr.rating_5 as public_rating_5,pr.rating_count as public_rating_count,pr.review_count as public_review_count,pr.source_url as public_rating_url,pr.fetched_at as public_rating_fetched_at,b.notes,
e.cover_locked,e.cover_uploaded_by_user,e.exact_copy_verified,e.exact_copy_verified_at,e.exact_copy_verification_source,e.identity_locked
from public.books b join public.library_entries l on l.book_id=b.id
left join public.book_authors ba on ba.book_id=b.id left join public.authors a on a.id=ba.author_id left join public.book_series bs on bs.book_id=b.id left join public.series s on s.id=bs.series_id left join public.editions e on e.id=coalesce(l.current_edition_id,b.reference_edition_id)
left join lateral (select x.* from public.public_ratings x where x.book_id=b.id order by x.is_primary desc,case lower(x.provider) when 'goodreads' then 1 when 'google books' then 2 when 'open library' then 3 else 9 end,x.fetched_at desc limit 1) pr on true
group by b.id,l.id,e.id,pr.id,pr.provider,pr.rating_5,pr.rating_count,pr.review_count,pr.source_url,pr.fetched_at;
