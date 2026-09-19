-- Private reader identity and avatar storage for the Profile surface.
-- The application remains single-owner today, but every record and object is
-- also explicitly scoped to auth.uid() for safe future multi-user operation.

create table if not exists public.reader_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 120),
  handle text check (handle is null or char_length(handle) <= 80),
  short_bio text check (short_bio is null or char_length(short_bio) <= 280),
  avatar_path text check (avatar_path is null or char_length(avatar_path) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reader_profiles enable row level security;
revoke all on public.reader_profiles from anon;
grant select, insert, update, delete on public.reader_profiles to authenticated;

drop policy if exists reader_profiles_owner on public.reader_profiles;
create policy reader_profiles_owner on public.reader_profiles
  for all to authenticated
  using (private.is_owner() and user_id = (select auth.uid()))
  with check (private.is_owner() and user_id = (select auth.uid()));

drop trigger if exists reader_profiles_updated_at on public.reader_profiles;
create trigger reader_profiles_updated_at
  before update on public.reader_profiles
  for each row execute function private.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reader-avatars', 'reader-avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists reader_avatars_select on storage.objects;
create policy reader_avatars_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'reader-avatars'
    and private.is_owner()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists reader_avatars_insert on storage.objects;
create policy reader_avatars_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'reader-avatars'
    and private.is_owner()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists reader_avatars_update on storage.objects;
create policy reader_avatars_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'reader-avatars'
    and private.is_owner()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'reader-avatars'
    and private.is_owner()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists reader_avatars_delete on storage.objects;
create policy reader_avatars_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'reader-avatars'
    and private.is_owner()
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
