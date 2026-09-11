-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function public.protect_locked_edition_identity()
returns trigger
language plpgsql
set search_path=''
as $$
declare
  v_manual_owner boolean := false;
begin
  -- Signed-in owner edits are deliberate. Service-role/background enrichment has no auth.uid().
  if auth.uid() is not null then
    begin
      v_manual_owner := private.is_owner();
    exception when others then
      v_manual_owner := false;
    end;
  end if;

  if old.identity_locked and not v_manual_owner then
    new.isbn10 := old.isbn10;
    new.isbn13 := old.isbn13;
    new.publisher := old.publisher;
    new.imprint := old.imprint;
    new.publication_year := old.publication_year;
    new.publication_date := old.publication_date;
    new.country := old.country;
    new.language := old.language;
    new.format := old.format;
    new.binding := old.binding;
    new.edition_statement := old.edition_statement;
    new.printing_impression := old.printing_impression;
    new.number_line := old.number_line;
    new.first_edition := old.first_edition;
    new.first_uk_edition := old.first_uk_edition;
    new.first_paperback_edition := old.first_paperback_edition;
    new.page_count := old.page_count;
  end if;

  return new;
end;
$$;

drop trigger if exists editions_protect_locked_identity on public.editions;
create trigger editions_protect_locked_identity
before update on public.editions
for each row
execute function public.protect_locked_edition_identity();
