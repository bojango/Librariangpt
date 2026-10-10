-- Existing server automations use a service-role JWT, rather than a user's session.
-- Resolve only the configured library owner; no caller-supplied user ID.
create function private.author_automation_librarian_entry(p_source text,p_content text,p_idempotency_key text,
  p_book_id uuid,p_tags text[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare u uuid; result uuid;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  select owner_user_id into u from private.app_state where singleton;
  if u is null then raise exception 'Library owner not configured'; end if;
  if p_source not in ('system','user','librarian','automation') or p_source is null then raise exception 'Invalid source'; end if;
  if nullif(btrim(p_content),'') is null or length(p_content)>12000 then raise exception 'Content required (maximum 12000 characters)'; end if;
  if nullif(btrim(p_idempotency_key),'') is null or length(p_idempotency_key)>220 then raise exception 'Idempotency key required'; end if;
  if p_book_id is not null and not exists(select 1 from public.library_entries where user_id=u and book_id=p_book_id) then
    raise exception 'Book is not in the owner library' using errcode='42501';
  end if;
  if cardinality(p_tags)>20 or exists(select 1 from unnest(p_tags) tag where tag !~ '^[a-z0-9_]+$' or length(tag)>40) then
    raise exception 'Invalid hashtags';
  end if;
  insert into public.activity_events(user_id,idempotency_key,event_type,source,content,book_id,hashtags)
    values(u,'librarian:'||p_idempotency_key,'librarian',p_source,p_content,p_book_id,array['librarian']||coalesce(p_tags,'{}'))
    on conflict(user_id,idempotency_key) do nothing returning id into result;
  if result is null then select id into result from public.activity_events where user_id=u and idempotency_key='librarian:'||p_idempotency_key; end if;
  return result;
end $$;
revoke all on function private.author_automation_librarian_entry(text,text,text,uuid,text[]) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.author_automation_librarian_entry(text,text,text,uuid,text[]) to service_role;
create function public.add_automation_librarian_entry(p_source text,p_content text,p_idempotency_key text,
  p_book_id uuid default null,p_tags text[] default '{}') returns uuid
language sql security invoker set search_path='' as $$
  select private.author_automation_librarian_entry(p_source,p_content,p_idempotency_key,p_book_id,p_tags);
$$;
revoke all on function public.add_automation_librarian_entry(text,text,text,uuid,text[]) from public,anon,authenticated;
grant execute on function public.add_automation_librarian_entry(text,text,text,uuid,text[]) to service_role;
