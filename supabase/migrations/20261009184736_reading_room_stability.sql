-- Review and apply to a dedicated test DB first. No production data repair.
-- This legacy RPC exists in production but is absent from some clean checkouts.
do $$ begin
 if to_regprocedure('public.record_reading_checkin_bridge(uuid,uuid,text,integer,integer,text)') is not null then
  revoke execute on function public.record_reading_checkin_bridge(uuid,uuid,text,integer,integer,text) from public,anon,authenticated;
  grant execute on function public.record_reading_checkin_bridge(uuid,uuid,text,integer,integer,text) to service_role;
 end if;
end $$;
create or replace function public.save_cover_selection(
 p_user_id uuid,p_book_id uuid,p_edition_id uuid,p_url text,p_provider text,p_label text,
 p_uploaded boolean,p_lock boolean,p_width integer default null,p_height integer default null
) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.library_entries where user_id=p_user_id and book_id=p_book_id) then raise exception 'Book not in library'; end if;
 perform 1 from public.books where id=p_book_id for update;
 if p_edition_id is not null and not exists(select 1 from public.editions where id=p_edition_id and book_id=p_book_id) then raise exception 'Edition does not belong to book'; end if;
 perform set_config('reading_room.manual_cover','on',true);
 update public.book_cover_candidates set selected=false where book_id=p_book_id and selected;
 insert into public.book_cover_candidates(book_id,edition_id,provider,source_label,source_url,exact_edition,selected,width,height)
 values(p_book_id,p_edition_id,p_provider,p_label,p_url,coalesce((select owned from public.editions where id=p_edition_id),false),true,p_width,p_height)
 on conflict(book_id,source_url) do update set selected=true,edition_id=excluded.edition_id;
 update public.editions set cover_url=p_url,cover_source=p_provider,cover_verified=true,cover_locked=p_lock,cover_uploaded_by_user=p_uploaded,updated_at=now() where id=p_edition_id;
 update public.books set cover_url_preferred=p_url,cover_source=p_provider,cover_verified=true,cover_locked=p_lock,updated_at=now() where id=p_book_id;
 insert into public.library_events(user_id,book_id,event_type,source,payload) values(p_user_id,p_book_id,'cover_selected','frontend',jsonb_build_object('edition_id',p_edition_id,'uploaded',p_uploaded,'locked',p_lock));
end $$;
revoke all on function public.save_cover_selection(uuid,uuid,uuid,text,text,text,boolean,boolean,integer,integer) from public,anon,authenticated;
grant execute on function public.save_cover_selection(uuid,uuid,uuid,text,text,text,boolean,boolean,integer,integer) to service_role;

create or replace function private.protect_book_cover() returns trigger language plpgsql set search_path='' as $$
begin
 if old.cover_locked and current_setting('reading_room.manual_cover',true) is distinct from 'on' then
  new.cover_url_preferred:=old.cover_url_preferred; new.cover_source:=old.cover_source;
  new.cover_verified:=old.cover_verified; new.cover_locked:=old.cover_locked;
 end if;
 return new;
end $$;
create trigger books_protect_cover before update on public.books for each row execute function private.protect_book_cover();

-- Preserve column ordering and the existing rating-provider selection.
do $$ declare v text; begin
 v:=pg_get_viewdef('public.v_library'::regclass,true);
 if position('COALESCE(e.cover_url, b.cover_url_preferred) AS cover_url' in v)=0 then raise exception 'Unexpected v_library definition: review cover precedence before applying'; end if;
 v:=replace(v,'COALESCE(e.cover_url, b.cover_url_preferred) AS cover_url','CASE WHEN b.cover_locked THEN COALESCE(b.cover_url_preferred, e.cover_url) ELSE COALESCE(e.cover_url, b.cover_url_preferred) END AS cover_url');
 v:=replace(v,'e.cover_source,','CASE WHEN b.cover_locked THEN b.cover_source ELSE COALESCE(e.cover_source,b.cover_source) END AS cover_source,');
 v:=replace(v,'e.cover_verified,','CASE WHEN b.cover_locked THEN b.cover_verified ELSE COALESCE(e.cover_verified,b.cover_verified) END AS cover_verified,');
 v:=replace(v,'e.cover_locked,','(b.cover_locked OR COALESCE(e.cover_locked,false)) AS cover_locked,');
 execute 'create or replace view public.v_library with (security_invoker=true) as '||v;
end $$;

create index if not exists book_quotes_book_idx on public.book_quotes(book_id);
create index if not exists book_quotes_edition_idx on public.book_quotes(edition_id);

-- A short per-book lease prevents concurrent refresh clicks from multiplying requests.
create or replace function public.claim_edition_discovery(p_book_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_last timestamptz;
begin
 select editions_last_refreshed_at into v_last from public.books where id=p_book_id for update;
 if not found or v_last>now()-interval '60 seconds' then return false; end if;
 update public.books set editions_status='refreshing',editions_error=null,editions_last_refreshed_at=now() where id=p_book_id;
 return true;
end $$;
revoke all on function public.claim_edition_discovery(uuid) from public,anon,authenticated;
grant execute on function public.claim_edition_discovery(uuid) to service_role;

create or replace function public.add_manual_edition(
 p_book_id uuid,p_isbn text,p_publisher text default null,p_year integer default null,p_format text default null,
 p_pages integer default null,p_language text default null,p_statement text default null,p_evidence text default null
) returns uuid language plpgsql security invoker set search_path='' as $$
declare v_isbn text:=upper(regexp_replace(p_isbn,'[^0-9Xx]','','g')); v_sum integer:=0; v_13 text; v_id uuid; i integer;
begin
 if not private.is_owner() or auth.uid() is null then raise exception 'Not authorized'; end if;
 if not exists(select 1 from public.library_entries where book_id=p_book_id and user_id=auth.uid()) then raise exception 'Book not in library'; end if;
 if nullif(btrim(p_evidence),'') is null or length(p_evidence)>1000 then raise exception 'Edition source evidence is required'; end if;
 if length(v_isbn)=13 and v_isbn ~ '^97[89][0-9]{10}$' then
  for i in 1..13 loop v_sum:=v_sum+substring(v_isbn,i,1)::integer*case when i%2=0 then 3 else 1 end; end loop;
  if v_sum%10<>0 then raise exception 'Invalid ISBN checksum'; end if; v_13:=v_isbn;
 elsif length(v_isbn)=10 and v_isbn ~ '^[0-9]{9}[0-9X]$' then
  for i in 1..10 loop v_sum:=v_sum+(case when substring(v_isbn,i,1)='X' then 10 else substring(v_isbn,i,1)::integer end)*(11-i); end loop;
  if v_sum%11<>0 then raise exception 'Invalid ISBN checksum'; end if;
  v_13:='978'||left(v_isbn,9); v_sum:=0;
  for i in 1..12 loop v_sum:=v_sum+substring(v_13,i,1)::integer*case when i%2=0 then 3 else 1 end; end loop;
  v_13:=v_13||((10-v_sum%10)%10)::text;
 else raise exception 'Invalid ISBN'; end if;
 if p_year not between 1000 and 2100 or p_pages not between 1 and 10000 then raise exception 'Invalid year or page count'; end if;
 if p_format is not null and p_format not in ('Hardcover','Paperback','eBook','Audiobook') then raise exception 'Invalid format'; end if;
 -- Serialise manual submissions, including ISBN-10/13 aliases and different books.
 perform pg_advisory_xact_lock(hashtextextended(v_13,0));
 if exists(select 1 from public.editions where book_id<>p_book_id and (regexp_replace(isbn13,'[^0-9]','','g')=v_13 or (left(v_13,3)='978' and left(regexp_replace(isbn10,'[^0-9Xx]','','g'),9)=substring(v_13,4,9)))) then raise exception 'ISBN already belongs to another book. Check the title and author.'; end if;
 select id into v_id from public.editions where book_id=p_book_id and (regexp_replace(isbn13,'[^0-9]','','g')=v_13 or (left(v_13,3)='978' and left(regexp_replace(isbn10,'[^0-9Xx]','','g'),9)=substring(v_13,4,9))) limit 1;
 if v_id is not null then return v_id; end if;
 insert into public.editions(book_id,isbn13,isbn10,publisher,publication_year,format,page_count,language,edition_statement,metadata_source,metadata_match_confidence,metadata_payload,identity_locked)
 values(p_book_id,v_13,case when length(v_isbn)=10 then v_isbn end,nullif(btrim(p_publisher),''),p_year,p_format,p_pages,nullif(btrim(p_language),''),nullif(btrim(p_statement),''),'Manual edition','User supplied; source checked',jsonb_build_object('evidence',p_evidence),true) returning id into v_id;
 return v_id;
end $$;
revoke all on function public.add_manual_edition(uuid,text,text,integer,text,integer,text,text,text) from public,anon;
grant execute on function public.add_manual_edition(uuid,text,text,integer,text,integer,text,text,text) to authenticated;
