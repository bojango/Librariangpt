import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

export const hardeningMigration = 'supabase/migrations/20261006183351_harden_library_enrichment.sql';
export async function enrichmentDb({ hardened = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions; create schema storage; create schema cron;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table cron.job(jobid bigint generated always as identity,jobname text unique,schedule text,command text);
    create function cron.schedule(text,text,text) returns bigint language sql as $$
      insert into cron.job(jobname,schedule,command) values($1,$2,$3)
      on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid $$;
    create function cron.unschedule(bigint) returns boolean language sql as $$
      with removed as (delete from cron.job where jobid=$1 returning jobid) select exists(select 1 from removed) $$;
  `);
  const base = (await readFile('supabase/migrations/20260907092154_create_personal_library_schema.sql','utf8'))
    .replace('create extension if not exists pgcrypto with schema extensions;','')
    .replace("encode(extensions.digest('REDACTED_DEPLOYMENT_CLAIM_CODE','sha256'),'hex')", "'test-only'");
  await db.exec(base);
  for (const file of [
    '20260907103646_add_book_metadata_enrichment.sql',
    '20260907113807_add_reviews_public_ratings_and_precision_v3.sql',
    '20260907123428_persistent_cover_selection_and_library_notes.sql',
    '20260907153109_add_metadata_resolution_state.sql',
    '20260907154222_relax_edition_metadata_confidence.sql',
    '20260908071207_exact_owned_copy_identity.sql',
    '20260908071456_verified_copy_page_count_and_cover_lock.sql',
    '20260908071607_lock_verified_copy_identity.sql',
    '20260908072716_protect_verified_edition_identity.sql',
    '20260912202941_add_goodreads_rating_refresh.sql',
    '20260915083019_harden_goodreads_resolution_and_capacity.sql',
    '20260923145729_add_metadata_enrichment_queue.sql'
  ]) {
    const sql = (await readFile(`supabase/migrations/${file}`,'utf8'))
      .replace(/create extension if not exists pg_(?:cron|net)[^;]*;/g,'');
    await db.exec(sql);
  }
  await db.exec('grant select,insert,update,delete on all tables in schema public to service_role; grant usage,select on all sequences in schema public to service_role;');
  if (hardened) await db.exec(await readFile(hardeningMigration,'utf8'));
  return db;
}
