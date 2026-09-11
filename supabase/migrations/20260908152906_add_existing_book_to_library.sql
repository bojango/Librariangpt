-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.library_add_existing_book(
  p_book_id uuid,
  p_status text,
  p_ownership text,
  p_source text default 'frontend'
)
returns uuid
language plpgsql
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_id uuid;
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;
  if p_status not in ('Recommended','Wishlist','Owned - Unread','Currently Reading','Read','Paused','DNF','Not Interested') then raise exception 'Invalid status'; end if;
  if p_ownership not in ('Not Owned','Owned','On Order','Borrowed','Unknown') then raise exception 'Invalid ownership'; end if;
  if not exists(select 1 from public.books where id=p_book_id) then raise exception 'Book not found'; end if;

  insert into public.library_entries(user_id,book_id,overall_status,ownership_status,source,added_at,updated_at)
  values(v_uid,p_book_id,p_status,p_ownership,p_source,now(),now())
  on conflict(book_id) do update set
    user_id=v_uid,
    overall_status=excluded.overall_status,
    ownership_status=excluded.ownership_status,
    source=coalesce(public.library_entries.source,excluded.source),
    updated_at=now()
  returning id into v_id;

  update public.recommendations
  set recommendation_status = case
      when p_status='Wishlist' then 'Wishlist'
      when p_ownership='Owned' then 'Acquired'
      else recommendation_status
    end,
    is_active=false,
    frontend_featured=false,
    deactivated_at=coalesce(deactivated_at,now()),
    deactivation_reason=coalesce(deactivation_reason,case when p_status='Wishlist' then 'Added to wishlist' when p_ownership='Owned' then 'Added to owned library' else 'Added to library' end),
    updated_at=now()
  where user_id=v_uid and book_id=p_book_id and is_active=true;

  insert into public.library_events(user_id,book_id,event_type,source,payload)
  values(v_uid,p_book_id,'library_book_added',p_source,jsonb_build_object('status',p_status,'ownership',p_ownership));

  return v_id;
end;
$function$;

grant execute on function public.library_add_existing_book(uuid,text,text,text) to authenticated;
