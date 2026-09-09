-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.admin_edit_book(
  p_book_id uuid,
  p_library jsonb default '{}'::jsonb,
  p_book jsonb default '{}'::jsonb,
  p_edition_id uuid default null,
  p_edition jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_entry public.library_entries%rowtype;
  v_status text;
  v_ownership text;
  v_started timestamptz;
  v_completed timestamptz;
  v_session_id uuid;
  v_session_status text;
  v_display_edition uuid;
  v_author text;
  v_author_id uuid;
  v_ord int := 0;
  v_series_name text;
  v_series_id uuid;
  v_result jsonb;
begin
  if v_uid is null or not private.is_owner() then raise exception 'Not authorized'; end if;

  select * into v_entry from public.library_entries where book_id=p_book_id and user_id=v_uid for update;
  if not found then raise exception 'Book is not in this library'; end if;

  v_status := v_entry.overall_status;
  v_ownership := v_entry.ownership_status;
  v_started := v_entry.started_at;
  v_completed := v_entry.completed_at;

  if p_library ? 'overall_status' then
    v_status := nullif(trim(p_library->>'overall_status'),'');
    if v_status not in ('Recommended','Wishlist','Owned - Unread','Currently Reading','Read','Paused','DNF','Not Interested') then raise exception 'Invalid library status'; end if;
  end if;
  if p_library ? 'ownership_status' then
    v_ownership := nullif(trim(p_library->>'ownership_status'),'');
    if v_ownership not in ('Not Owned','Owned','On Order','Borrowed','Unknown') then raise exception 'Invalid ownership status'; end if;
  end if;
  if v_ownership='Owned' and not (p_library ? 'overall_status') and v_status in ('Recommended','Wishlist') then v_status := 'Owned - Unread'; end if;

  if p_library ? 'started_date' then
    v_started := case when nullif(trim(p_library->>'started_date'),'') is null then null else ((p_library->>'started_date')::date::timestamp at time zone 'Europe/London') end;
  end if;
  if p_library ? 'completed_date' then
    v_completed := case when nullif(trim(p_library->>'completed_date'),'') is null then null else ((p_library->>'completed_date')::date::timestamp at time zone 'Europe/London') end;
  end if;
  if v_started is not null and v_completed is not null and v_completed < v_started then raise exception 'Finished date cannot be before started date'; end if;

  v_display_edition := v_entry.current_edition_id;
  if p_library ? 'display_edition_id' then
    v_display_edition := case when nullif(trim(p_library->>'display_edition_id'),'') is null then null else (p_library->>'display_edition_id')::uuid end;
    if v_display_edition is not null and not exists(select 1 from public.editions where id=v_display_edition and book_id=p_book_id) then raise exception 'Edition does not belong to this book'; end if;
  end if;

  update public.library_entries set
    overall_status=v_status,
    ownership_status=v_ownership,
    reading_priority=case when p_library ? 'reading_priority' then nullif(trim(p_library->>'reading_priority'),'') else reading_priority end,
    current_edition_id=case when v_ownership='Owned' and (p_library ? 'display_edition_id') then v_display_edition else current_edition_id end,
    current_page=case when p_library ? 'current_page' then case when nullif(trim(p_library->>'current_page'),'') is null then null else (p_library->>'current_page')::integer end else current_page end,
    total_pages=case when p_library ? 'total_pages' then case when nullif(trim(p_library->>'total_pages'),'') is null then null else (p_library->>'total_pages')::integer end else total_pages end,
    started_at=v_started,
    completed_at=v_completed
  where id=v_entry.id;

  if v_ownership <> 'Owned' and (p_library ? 'display_edition_id') then
    update public.books set reference_edition_id=v_display_edition where id=p_book_id;
    if v_display_edition is not null then
      update public.editions set is_reference=(id=v_display_edition) where book_id=p_book_id;
    end if;
  end if;

  if p_book ? 'title' then update public.books set title=coalesce(nullif(trim(p_book->>'title'),''),title) where id=p_book_id; end if;
  if p_book ? 'subtitle' then update public.books set subtitle=nullif(trim(p_book->>'subtitle'),'') where id=p_book_id; end if;
  if p_book ? 'original_publication_year' then update public.books set original_publication_year=case when nullif(trim(p_book->>'original_publication_year'),'') is null then null else (p_book->>'original_publication_year')::integer end where id=p_book_id; end if;
  if p_book ? 'fiction_nonfiction' then
    if nullif(trim(p_book->>'fiction_nonfiction'),'') is not null and (p_book->>'fiction_nonfiction') not in ('Fiction','Nonfiction') then raise exception 'Invalid fiction/nonfiction value'; end if;
    update public.books set fiction_nonfiction=nullif(trim(p_book->>'fiction_nonfiction'),'') where id=p_book_id;
  end if;
  if p_book ? 'primary_genre' then update public.books set primary_genre=nullif(trim(p_book->>'primary_genre'),'') where id=p_book_id; end if;
  if p_book ? 'language' then update public.books set language=nullif(trim(p_book->>'language'),'') where id=p_book_id; end if;
  if p_book ? 'synopsis' then update public.books set synopsis=nullif(trim(p_book->>'synopsis'),'') where id=p_book_id; end if;
  if p_book ? 'notes' then update public.books set notes=nullif(trim(p_book->>'notes'),'') where id=p_book_id; end if;
  if p_book ? 'themes_tags' then update public.books set themes_tags=coalesce(array(select jsonb_array_elements_text(p_book->'themes_tags')),'{}'::text[]) where id=p_book_id; end if;

  if p_book ? 'authors' then
    delete from public.book_authors where book_id=p_book_id and role='Author';
    for v_author in select trim(value) from jsonb_array_elements_text(p_book->'authors') where trim(value)<>'' loop
      v_ord := v_ord+1;
      insert into public.authors(name) values(v_author) on conflict(name) do update set name=excluded.name returning id into v_author_id;
      insert into public.book_authors(book_id,author_id,author_order,role) values(p_book_id,v_author_id,v_ord,'Author') on conflict(book_id,author_id) do update set author_order=excluded.author_order,role='Author';
    end loop;
  end if;

  if p_book ? 'series_name' then
    v_series_name := nullif(trim(p_book->>'series_name'),'');
    delete from public.book_series where book_id=p_book_id;
    if v_series_name is not null then
      insert into public.series(name) values(v_series_name) on conflict(name) do update set name=excluded.name returning id into v_series_id;
      insert into public.book_series(book_id,series_id,series_order) values(p_book_id,v_series_id,case when nullif(trim(p_book->>'series_order'),'') is null then null else (p_book->>'series_order')::numeric end);
    end if;
  elsif p_book ? 'series_order' then
    update public.book_series set series_order=case when nullif(trim(p_book->>'series_order'),'') is null then null else (p_book->>'series_order')::numeric end where book_id=p_book_id;
  end if;

  if p_edition_id is not null then
    if not exists(select 1 from public.editions where id=p_edition_id and book_id=p_book_id) then raise exception 'Edition does not belong to this book'; end if;
    update public.editions set
      isbn10=case when p_edition ? 'isbn10' then nullif(regexp_replace(p_edition->>'isbn10','[^0-9Xx]','','g'),'') else isbn10 end,
      isbn13=case when p_edition ? 'isbn13' then nullif(regexp_replace(p_edition->>'isbn13','[^0-9]','','g'),'') else isbn13 end,
      publisher=case when p_edition ? 'publisher' then nullif(trim(p_edition->>'publisher'),'') else publisher end,
      imprint=case when p_edition ? 'imprint' then nullif(trim(p_edition->>'imprint'),'') else imprint end,
      publication_year=case when p_edition ? 'publication_year' then case when nullif(trim(p_edition->>'publication_year'),'') is null then null else (p_edition->>'publication_year')::integer end else publication_year end,
      publication_date=case when p_edition ? 'publication_date' then case when nullif(trim(p_edition->>'publication_date'),'') is null then null else (p_edition->>'publication_date')::date end else publication_date end,
      country=case when p_edition ? 'country' then nullif(trim(p_edition->>'country'),'') else country end,
      language=case when p_edition ? 'language' then nullif(trim(p_edition->>'language'),'') else language end,
      format=case when p_edition ? 'format' then nullif(trim(p_edition->>'format'),'') else format end,
      binding=case when p_edition ? 'binding' then nullif(trim(p_edition->>'binding'),'') else binding end,
      edition_statement=case when p_edition ? 'edition_statement' then nullif(trim(p_edition->>'edition_statement'),'') else edition_statement end,
      printing_impression=case when p_edition ? 'printing_impression' then nullif(trim(p_edition->>'printing_impression'),'') else printing_impression end,
      number_line=case when p_edition ? 'number_line' then nullif(trim(p_edition->>'number_line'),'') else number_line end,
      page_count=case when p_edition ? 'page_count' then case when nullif(trim(p_edition->>'page_count'),'') is null then null else (p_edition->>'page_count')::integer end else page_count end,
      signed=case when p_edition ? 'signed' then case when jsonb_typeof(p_edition->'signed')='null' then null else (p_edition->>'signed')::boolean end else signed end,
      inscription=case when p_edition ? 'inscription' then nullif(trim(p_edition->>'inscription'),'') else inscription end,
      condition=case when p_edition ? 'condition' then nullif(trim(p_edition->>'condition'),'') else condition end,
      acquisition_date=case when p_edition ? 'acquisition_date' then case when nullif(trim(p_edition->>'acquisition_date'),'') is null then null else (p_edition->>'acquisition_date')::date end else acquisition_date end,
      acquisition_source=case when p_edition ? 'acquisition_source' then nullif(trim(p_edition->>'acquisition_source'),'') else acquisition_source end,
      acquisition_price=case when p_edition ? 'acquisition_price' then case when nullif(trim(p_edition->>'acquisition_price'),'') is null then null else (p_edition->>'acquisition_price')::numeric end else acquisition_price end,
      currency=case when p_edition ? 'currency' then upper(nullif(trim(p_edition->>'currency'),'')) else currency end,
      notes=case when p_edition ? 'notes' then nullif(trim(p_edition->>'notes'),'') else notes end
    where id=p_edition_id;

    if p_edition ? 'page_count' and (v_entry.current_edition_id=p_edition_id or (v_entry.current_edition_id is null and exists(select 1 from public.books where id=p_book_id and reference_edition_id=p_edition_id))) then
      update public.library_entries set total_pages=(select page_count from public.editions where id=p_edition_id) where id=v_entry.id;
      update public.reading_sessions set total_pages=(select page_count from public.editions where id=p_edition_id) where book_id=p_book_id and status in ('Reading','Paused');
    end if;
  end if;

  select id into v_session_id from public.reading_sessions where user_id=v_uid and book_id=p_book_id order by created_at desc limit 1;
  v_session_status := case v_status when 'Currently Reading' then 'Reading' when 'Read' then 'Completed' when 'Paused' then 'Paused' when 'DNF' then 'DNF' else null end;

  if v_session_id is null and (v_started is not null or v_completed is not null or v_session_status in ('Reading','Completed','Paused','DNF')) then
    if v_status='Currently Reading' and v_started is null then
      v_started := now();
      update public.library_entries set started_at=v_started where id=v_entry.id;
    end if;
    insert into public.reading_sessions(user_id,book_id,edition_id,session_type,status,started_at,current_page,total_pages,completed_at,last_progress_at)
    select v_uid,p_book_id,coalesce((select current_edition_id from public.library_entries where id=v_entry.id),p_edition_id),'First Read',coalesce(v_session_status,'Planned'),v_started,current_page,total_pages,v_completed,case when current_page is not null then now() else null end
    from public.library_entries where id=v_entry.id returning id into v_session_id;
  elsif v_session_id is not null then
    update public.reading_sessions set
      status=coalesce(v_session_status,status),
      edition_id=coalesce((select current_edition_id from public.library_entries where id=v_entry.id),edition_id),
      started_at=case when p_library ? 'started_date' then v_started else started_at end,
      completed_at=case when p_library ? 'completed_date' then v_completed else completed_at end,
      current_page=case when p_library ? 'current_page' then (select current_page from public.library_entries where id=v_entry.id) else current_page end,
      total_pages=case when p_library ? 'total_pages' or (p_edition ? 'page_count') then (select total_pages from public.library_entries where id=v_entry.id) else total_pages end
    where id=v_session_id;
  end if;

  update public.recommendations set recommendation_status=case
    when v_status='Read' then 'Read'
    when v_status='Currently Reading' then 'Reading'
    when v_ownership='Owned' then 'Acquired'
    when v_status='Wishlist' then 'Wishlist'
    when v_status='Not Interested' then 'Dismissed'
    else recommendation_status end
  where book_id=p_book_id;

  insert into public.library_events(user_id,book_id,session_id,event_type,source,payload)
  values(v_uid,p_book_id,v_session_id,'book_admin_edited','frontend',jsonb_build_object('library',p_library,'book',p_book,'edition_id',p_edition_id,'edition',p_edition));

  select to_jsonb(v) into v_result from public.v_library v where v.id=p_book_id;
  return jsonb_build_object('ok',true,'book',v_result,'session_id',v_session_id);
end;
$$;

revoke all on function public.admin_edit_book(uuid,jsonb,jsonb,uuid,jsonb) from public, anon;
grant execute on function public.admin_edit_book(uuid,jsonb,jsonb,uuid,jsonb) to authenticated;
