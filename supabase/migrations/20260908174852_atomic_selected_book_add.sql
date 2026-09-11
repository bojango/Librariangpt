-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.library_add_selected_result(p_result jsonb, p_status text, p_ownership text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_title text := nullif(trim(p_result->>'title'),'');
  v_author text := nullif(trim(p_result->'authors'->>0),'');
  v_isbn13 text := nullif(regexp_replace(coalesce(p_result->>'isbn13',''),'[^0-9]','','g'),'');
  v_isbn10 text := nullif(upper(regexp_replace(coalesce(p_result->>'isbn10',''),'[^0-9Xx]','','g')),'');
  v_book uuid;
  v_edition uuid;
  v_library uuid;
  v_author_id uuid;
  v_name text;
  v_idx int := 0;
  v_owned boolean := p_ownership='Owned';
  v_page_count int;
  v_year int;
  v_cover text := nullif(p_result->>'cover_url','');
  v_provider text := coalesce(nullif(p_result->>'provider',''),'Selected search result');
  v_provider_id text := nullif(p_result->>'provider_id','');
  v_existing_library boolean := false;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if v_title is null then raise exception 'Selected result has no title'; end if;
  if p_status not in ('Recommended','Wishlist','Owned - Unread','Currently Reading','Read','Paused','DNF','Not Interested') then raise exception 'Invalid status'; end if;
  if p_ownership not in ('Not Owned','Owned','On Order','Borrowed','Unknown') then raise exception 'Invalid ownership'; end if;
  if v_isbn13 is null and v_isbn10 is null then raise exception 'Selected result has no ISBN'; end if;
  if v_isbn13 is not null and length(v_isbn13)<>13 then raise exception 'Invalid ISBN-13'; end if;
  if v_isbn10 is not null and length(v_isbn10)<>10 then raise exception 'Invalid ISBN-10'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(v_isbn13,v_isbn10,lower(v_title)||'|'||lower(coalesce(v_author,''))),0));

  select e.book_id,e.id into v_book,v_edition
  from public.editions e
  where (v_isbn13 is not null and e.isbn13=v_isbn13) or (v_isbn10 is not null and e.isbn10=v_isbn10)
  order by e.created_at limit 1;

  if v_book is not null then
    select exists(select 1 from public.library_entries le where le.book_id=v_book and le.user_id=v_uid) into v_existing_library;
    if v_existing_library then
      return jsonb_build_object('ok',true,'already_in_library',true,'book_id',v_book,'edition_id',v_edition);
    end if;
  else
    select b.id into v_book
    from public.books b
    where lower(trim(b.title))=lower(v_title)
      and (v_author is null or exists(
        select 1 from public.book_authors ba join public.authors a on a.id=ba.author_id
        where ba.book_id=b.id and lower(trim(a.name))=lower(v_author)
      ))
    order by b.created_at
    limit 1;

    if v_book is null then
      insert into public.books(title,original_publication_year,cover_url_preferred,cover_source,cover_verified,metadata_source,metadata_last_updated,metadata_status,metadata_confidence,notes)
      values(
        v_title,
        case when (p_result->>'publication_year') ~ '^\d{4}$' then (p_result->>'publication_year')::int else null end,
        v_cover,v_provider,(v_cover is not null),v_provider,current_date,'resolved',0.95,
        'Created from an explicitly selected Reading Room search result.'
      ) returning id into v_book;

      for v_name in select jsonb_array_elements_text(coalesce(p_result->'authors','[]'::jsonb)) loop
        v_name := nullif(trim(v_name),'');
        if v_name is null then continue; end if;
        v_idx := v_idx + 1;
        insert into public.authors(name) values(v_name)
        on conflict(name) do update set updated_at=now()
        returning id into v_author_id;
        insert into public.book_authors(book_id,author_id,author_order,role)
        values(v_book,v_author_id,v_idx,'Author') on conflict do nothing;
      end loop;
    end if;

    v_page_count := case when coalesce(p_result->>'page_count','') ~ '^\d+$' then (p_result->>'page_count')::int else null end;
    v_year := case when coalesce(p_result->>'publication_year','') ~ '^\d{4}$' then (p_result->>'publication_year')::int else null end;

    insert into public.editions(
      book_id,owned,preferred_copy,isbn10,isbn13,publisher,publication_year,format,page_count,
      cover_url,cover_source,cover_verified,edition_match_confidence,open_library_edition_id,google_books_volume_id,
      metadata_source,metadata_last_fetched_at,metadata_match_confidence,metadata_payload,is_reference
    ) values(
      v_book,v_owned,v_owned,v_isbn10,v_isbn13,nullif(p_result->>'publisher',''),v_year,nullif(p_result->>'format',''),v_page_count,
      v_cover,v_provider,(v_cover is not null),'User selected search result',
      case when v_provider ilike 'Open Library%' then regexp_replace(coalesce(v_provider_id,''),'^/books/','') else null end,
      case when v_provider ilike 'Google Books%' then v_provider_id else null end,
      v_provider,now(),'Selected result',p_result,not v_owned
    ) returning id into v_edition;

    update public.books set
      reference_edition_id=coalesce(reference_edition_id,v_edition),
      cover_url_preferred=coalesce(v_cover,cover_url_preferred),
      cover_source=case when v_cover is not null then v_provider else cover_source end,
      cover_verified=case when v_cover is not null then true else cover_verified end,
      metadata_status='resolved',metadata_confidence=greatest(coalesce(metadata_confidence,0),0.95),metadata_resolved_at=now(),updated_at=now()
    where id=v_book;
  end if;

  v_page_count := case when coalesce(p_result->>'page_count','') ~ '^\d+$' then (p_result->>'page_count')::int else null end;
  insert into public.library_entries(user_id,book_id,overall_status,ownership_status,current_edition_id,total_pages,source,added_at,updated_at)
  values(v_uid,v_book,p_status,p_ownership,case when v_owned then v_edition else null end,v_page_count,'selected-search-result',now(),now())
  on conflict(book_id) do update set
    user_id=v_uid,overall_status=excluded.overall_status,ownership_status=excluded.ownership_status,
    current_edition_id=coalesce(excluded.current_edition_id,public.library_entries.current_edition_id),
    total_pages=coalesce(excluded.total_pages,public.library_entries.total_pages),updated_at=now()
  returning id into v_library;

  update public.recommendations set
    recommendation_status=case when p_status='Wishlist' then 'Wishlist' when v_owned then 'Acquired' else recommendation_status end,
    is_active=false,frontend_featured=false,deactivated_at=coalesce(deactivated_at,now()),
    deactivation_reason=coalesce(deactivation_reason,case when p_status='Wishlist' then 'Added to wishlist' when v_owned then 'Added to owned library' else 'Added to library' end),updated_at=now()
  where user_id=v_uid and book_id=v_book and is_active=true;

  insert into public.library_events(user_id,book_id,event_type,source,payload)
  values(v_uid,v_book,'library_book_added','selected-search-result',jsonb_build_object('status',p_status,'ownership',p_ownership,'edition_id',v_edition,'provider',v_provider));

  return jsonb_build_object('ok',true,'already_in_library',false,'book_id',v_book,'edition_id',v_edition,'library_entry_id',v_library);
end;
$function$;

grant execute on function public.library_add_selected_result(jsonb,text,text) to authenticated;
