alter table public.accolades
  add column if not exists logo_source_url text,
  add column if not exists logo_source_name text;

comment on column public.accolades.logo_source_url is
  'Original official or authoritative page or asset URL used to source logo_url.';
comment on column public.accolades.logo_source_name is
  'Human-readable organisation or publisher responsible for the source asset.';

create index if not exists book_accolades_accolade_idx
  on public.book_accolades (accolade_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('award-logos', 'award-logos', true, 1048576, array['image/png', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists owner_manage_award_logos on storage.objects;
create policy owner_manage_award_logos
on storage.objects
for all
to authenticated
using (bucket_id = 'award-logos' and private.is_owner())
with check (bucket_id = 'award-logos' and private.is_owner());
