-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.prepare_verified_copy_lock() returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.exact_copy_verified then
    new.identity_locked := true;
    new.cover_locked := true;
    if new.exact_copy_verified_at is null then new.exact_copy_verified_at := now(); end if;
    if new.exact_copy_verification_source is null then new.exact_copy_verification_source := 'frontend'; end if;
  end if;
  return new;
end;
$$;

drop trigger if exists editions_prepare_verified_copy_lock on public.editions;
create trigger editions_prepare_verified_copy_lock
before insert or update of exact_copy_verified on public.editions
for each row execute function public.prepare_verified_copy_lock();

create or replace function public.sync_verified_copy_book_cover() returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.exact_copy_verified and (tg_op='INSERT' or old.exact_copy_verified is distinct from new.exact_copy_verified) then
    update public.books
      set cover_url_preferred=new.cover_url,
          cover_source=case when new.cover_url is null then cover_source else new.cover_source end,
          cover_verified=case when new.cover_url is null then false else new.cover_verified end,
          cover_locked=true,
          updated_at=now()
    where id=new.book_id;
  end if;
  return new;
end;
$$;

drop trigger if exists editions_sync_verified_copy_cover on public.editions;
create trigger editions_sync_verified_copy_cover
after insert or update of exact_copy_verified on public.editions
for each row execute function public.sync_verified_copy_book_cover();
