-- Artwork delivery is not material reading evidence. Adding a cover alone must
-- not consume another personalised inference attempt.
create or replace function private.collection_content_version(w public.collection_catalogue_books) returns text language sql immutable set search_path='' as $$
 select md5(jsonb_build_array(w.title,w.authors,w.synopsis,w.publication_year,w.source_url,
  (select coalesce(jsonb_agg(e order by e),'[]') from jsonb_array_elements(w.metadata_sources) e where not(e ? 'fields') or e->'fields' ? 'synopsis' or e->'fields' ? 'publication_year'))::text) $$;

-- A trusted Librarian may retain a concise factual summary from a source it has
-- actually reviewed. Bibliography stays independently retryable; no opinion or
-- invented provider response is substituted for a source description.
create function public.record_catalogue_source_summary(p_work_key text,p_title text,p_authors text,p_source_url text,p_summary text) returns boolean
 language plpgsql security invoker set search_path='' as $$
declare w public.collection_catalogue_books; source jsonb;
begin
 if current_user<>'postgres' then raise exception 'Trusted Librarian connector required' using errcode='42501';end if;
 if length(trim(coalesce(p_summary,''))) not between 60 and 6000 or coalesce(p_source_url,'') not like 'https://%' then raise exception 'Reviewed source and factual summary required';end if;
 select * into w from public.collection_catalogue_books where key=p_work_key for update;
 if not found or private.collection_text(w.title)<>private.collection_text(p_title) or private.collection_text(w.authors)<>private.collection_text(p_authors) then raise exception 'Source identity mismatch';end if;
 if nullif(w.synopsis,'') is not null then return false;end if;
 source:=jsonb_build_object('provider','Reviewed publisher / author source','source_url',p_source_url,'fields',jsonb_build_array('synopsis'),'description_kind','concise factual source summary');
 update public.collection_catalogue_books set synopsis=trim(p_summary),metadata_sources=metadata_sources||jsonb_build_array(source) where key=p_work_key;
 return true;
end $$;
revoke all on function public.record_catalogue_source_summary(text,text,text,text,text) from public,anon,authenticated,service_role;
-- Publication and ordinary reconciliation retain their existing fencing. A
-- source summary queues a new content revision on the next reconciliation.
