create or replace function public.library_add_related_result(
  p_result jsonb,
  p_series_name text default null,
  p_series_order numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
  v_book uuid;
  v_series uuid;
  v_series_name text := nullif(trim(p_series_name), '');
begin
  if not private.is_owner() then raise exception 'Not authorized'; end if;

  v_result := public.library_add_selected_result(p_result, 'Wishlist', 'Not Owned');
  v_book := nullif(v_result->>'book_id', '')::uuid;

  if v_book is not null and v_series_name is not null then
    insert into public.series(name)
    values(v_series_name)
    on conflict(name) do update set updated_at = now()
    returning id into v_series;

    insert into public.book_series(book_id, series_id, series_order)
    values(v_book, v_series, p_series_order)
    on conflict(book_id, series_id) do update
      set series_order = coalesce(excluded.series_order, public.book_series.series_order);
  end if;

  return v_result || jsonb_build_object('series_id', v_series);
end;
$function$;

grant execute on function public.library_add_related_result(jsonb,text,numeric) to authenticated;

-- Jurassic Park already existed before series metadata was fully normalised.
insert into public.book_series(book_id, series_id, series_order)
select b.id, s.id, 1
from public.books b
join public.book_authors ba on ba.book_id = b.id
join public.authors a on a.id = ba.author_id
cross join public.series s
where lower(trim(b.title)) = 'jurassic park'
  and lower(trim(a.name)) = 'michael crichton'
  and lower(trim(s.name)) = 'jurassic park'
on conflict(book_id, series_id) do update set series_order = excluded.series_order;
