-- Personal library identity; no global default and no changes to owner-only RLS.
alter table public.reader_profiles add column library_name text
  check (library_name is null or char_length(library_name)<=120);

insert into public.reader_profiles(user_id,library_name)
select owner_user_id,'Alder Creek Library' from private.app_state
where singleton and owner_user_id is not null
on conflict(user_id) do update set library_name=coalesce(reader_profiles.library_name,excluded.library_name);
