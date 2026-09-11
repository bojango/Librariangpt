-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

alter table public.books
  add column if not exists editions_status text not null default 'unresolved',
  add column if not exists editions_last_refreshed_at timestamptz,
  add column if not exists editions_error text;

alter table public.books drop constraint if exists books_editions_status_check;
alter table public.books add constraint books_editions_status_check check (editions_status in ('unresolved','refreshing','ready','partial','failed'));

create unique index if not exists editions_book_open_library_unique
  on public.editions(book_id, open_library_edition_id)
  where open_library_edition_id is not null;
create unique index if not exists editions_book_google_books_unique
  on public.editions(book_id, google_books_volume_id)
  where google_books_volume_id is not null;
create unique index if not exists editions_book_isbn13_unique
  on public.editions(book_id, isbn13)
  where isbn13 is not null;
create unique index if not exists editions_book_isbn10_unique
  on public.editions(book_id, isbn10)
  where isbn10 is not null;
create index if not exists editions_book_catalog_sort
  on public.editions(book_id, owned desc, preferred_copy desc, publication_year desc nulls last);

create or replace function public.select_book_edition(
  p_book_id uuid,
  p_edition_id uuid,
  p_mark_owned boolean default false,
  p_progress_mode text default 'page',
  p_source text default 'frontend'
) returns jsonb
language plpgsql
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_status text;
  v_ownership text;
  v_old_edition uuid;
  v_old_pages integer;
  v_old_page integer;
  v_new_pages integer;
  v_new_page integer;
  v_is_reading boolean := false;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_progress_mode not in ('page','percentage') then raise exception 'Invalid progress mode'; end if;

  select overall_status, ownership_status, current_edition_id, total_pages, current_page
    into v_status, v_ownership, v_old_edition, v_old_pages, v_old_page
  from public.library_entries
  where user_id=v_uid and book_id=p_book_id;
  if not found then raise exception 'Book not found in library'; end if;

  select page_count into v_new_pages
  from public.editions
  where id=p_edition_id and book_id=p_book_id;
  if not found then raise exception 'Edition does not belong to this book'; end if;

  v_is_reading := v_status in ('Currently Reading','Paused');
  v_new_page := v_old_page;
  if v_is_reading and v_old_page is not null and v_new_pages is not null then
    if p_progress_mode='percentage' and coalesce(v_old_pages,0)>0 then
      v_new_page := least(v_new_pages, greatest(0, round((v_old_page::numeric / v_old_pages::numeric) * v_new_pages)::integer));
    else
      v_new_page := least(v_old_page, v_new_pages);
    end if;
  end if;

  if p_mark_owned then
    update public.editions set preferred_copy=false, updated_at=now()
      where book_id=p_book_id and id<>p_edition_id and preferred_copy=true;
    update public.editions set owned=true, preferred_copy=true, is_reference=false, updated_at=now()
      where id=p_edition_id;
    update public.library_entries
      set ownership_status='Owned',
          overall_status=case when overall_status in ('Recommended','Wishlist') then 'Owned - Unread' else overall_status end,
          current_edition_id=p_edition_id,
          total_pages=coalesce(v_new_pages,total_pages),
          current_page=case when v_is_reading then v_new_page else current_page end,
          updated_at=now()
      where user_id=v_uid and book_id=p_book_id;
    update public.recommendations set recommendation_status='Acquired', updated_at=now()
      where user_id=v_uid and book_id=p_book_id and recommendation_status in ('New','Shortlisted','Wishlist');
  elsif v_is_reading or v_ownership in ('Owned','Borrowed','On Order') then
    update public.library_entries
      set current_edition_id=p_edition_id,
          total_pages=coalesce(v_new_pages,total_pages),
          current_page=case when v_is_reading then v_new_page else current_page end,
          updated_at=now()
      where user_id=v_uid and book_id=p_book_id;
  else
    update public.editions set is_reference=false, updated_at=now()
      where book_id=p_book_id and is_reference=true and id<>p_edition_id and coalesce(owned,false)=false;
    update public.editions set is_reference=true, updated_at=now() where id=p_edition_id;
    update public.books set reference_edition_id=p_edition_id, updated_at=now() where id=p_book_id;
    update public.library_entries
      set current_edition_id=null,
          total_pages=v_new_pages,
          updated_at=now()
      where user_id=v_uid and book_id=p_book_id;
  end if;

  if v_is_reading then
    update public.reading_sessions
      set edition_id=p_edition_id,
          total_pages=coalesce(v_new_pages,total_pages),
          current_page=coalesce(v_new_page,current_page),
          updated_at=now()
      where user_id=v_uid and book_id=p_book_id and status in ('Reading','Paused');
  end if;

  insert into public.library_events(user_id,book_id,event_type,source,payload)
  values(v_uid,p_book_id,'edition_selected',p_source,
    jsonb_build_object('old_edition_id',v_old_edition,'edition_id',p_edition_id,'mark_owned',p_mark_owned,
      'progress_mode',p_progress_mode,'old_page',v_old_page,'new_page',v_new_page,'old_total_pages',v_old_pages,'new_total_pages',v_new_pages));

  return jsonb_build_object('saved',true,'edition_id',p_edition_id,'mark_owned',p_mark_owned,
    'current_page',v_new_page,'total_pages',v_new_pages,'overall_status',case when p_mark_owned and v_status in ('Recommended','Wishlist') then 'Owned - Unread' else v_status end);
end;
$function$;

grant execute on function public.select_book_edition(uuid,uuid,boolean,text,text) to authenticated;
