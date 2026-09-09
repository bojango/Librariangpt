-- Exported read-only from deployed Supabase migration history on 2026-09-09.
-- Preserve ordering and review against a development branch before applying anywhere.

create or replace function private.remove_started_book_from_up_next()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.overall_status='Currently Reading' and old.overall_status is distinct from new.overall_status then
    delete from public.up_next_queue where book_id=new.book_id and (user_id=new.user_id or new.user_id is null);
    with ranked as (
      select id,user_id,row_number() over(partition by user_id order by position,added_at) rn
      from public.up_next_queue
    )
    update public.up_next_queue q set position=r.rn from ranked r where q.id=r.id;
  end if;
  return new;
end;
$$;

drop trigger if exists library_entry_remove_started_up_next on public.library_entries;
create trigger library_entry_remove_started_up_next
after update of overall_status on public.library_entries
for each row execute function private.remove_started_book_from_up_next();
