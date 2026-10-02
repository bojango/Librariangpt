import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';

export const owner = '10000000-0000-0000-0000-000000000001';
export const other = '10000000-0000-0000-0000-000000000002';
export const bookId = n => `20000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
export const sessionId = '30000000-0000-0000-0000-000000000001';
export const migrationPath = 'supabase/migrations/20260929115125_contextual_next_read_planner.sql';

export async function plannerDb() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to authenticated,service_role,anon;
    grant execute on all functions in schema auth to authenticated,service_role,anon;
  `);
  // Use the repository's actual schema/RPCs. Replace only the deployment-only claim bootstrap.
  let base = await readFile('supabase/migrations/20260907092154_create_personal_library_schema.sql', 'utf8');
  base = base.replace('create extension if not exists pgcrypto with schema extensions;', '')
    .replace("encode(extensions.digest('REDACTED_DEPLOYMENT_CLAIM_CODE','sha256'),'hex')", "'test-only'");
  await db.exec(base);
  for (const file of [
    '20260907093543_harden_api_and_add_library_actions.sql',
    '20260907184340_add_up_next_queue.sql',
    '20260907184508_auto_remove_started_book_from_up_next.sql'
  ]) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  await db.exec(`
    alter table public.books add column reference_edition_id uuid references public.editions(id);
    alter table public.recommendations add column match_confidence text;
    insert into auth.users values ('${owner}'),('${other}');
    update private.app_state set owner_user_id='${owner}';
    select set_config('request.jwt.claim.sub','${owner}',false);
    grant usage on schema private to authenticated;
    grant execute on function private.is_owner() to authenticated;
  `);
  await db.exec(await readFile(migrationPath, 'utf8'));
  await db.exec(await readFile('supabase/migrations/20260929120108_harden_next_read_transition_claim.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20260929172145_strengthen_next_read_queue.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20260929172447_specific_next_read_reasons.sql', 'utf8'));
  await db.exec(await readFile('supabase/migrations/20260929172647_precise_next_read_evidence.sql', 'utf8'));
  return db;
}

export async function seed(db) {
  for (let n = 1; n <= 12; n++) {
    await db.query(`insert into public.books(id,title,fiction_nonfiction,primary_genre,themes_tags)
      values($1,$2,$3,$4,$5)`, [bookId(n), n === 1 ? 'Long SF' : `Short nonfiction ${n}`,
      n === 1 ? 'Fiction' : 'Nonfiction', n === 1 ? 'Science Fiction' : 'Reportage', ['Exploration']]);
    await db.query(`insert into public.library_entries(user_id,book_id,overall_status,ownership_status,total_pages)
      values($1,$2,'Owned - Unread','Owned',$3)`, [owner, bookId(n), n === 1 ? 608 : 180 + n]);
    await db.query(`insert into public.recommendations(user_id,book_id,match_score_10,recommendation_strength,recommendation_status)
      values($1,$2,$3,'Strong','Acquired')`, [owner, bookId(n), n === 1 ? 9.9 : 8]);
  }
  await db.query(`insert into public.books(id,title,fiction_nonfiction,primary_genre) values($1,'Current long thriller','Fiction','Science Fiction')`, [bookId(99)]);
  await db.query(`insert into public.library_entries(user_id,book_id,overall_status,ownership_status,total_pages,current_page)
    values($1,$2,'Currently Reading','Owned',364,273)`, [owner, bookId(99)]);
  await db.query(`insert into public.reading_sessions(id,user_id,book_id,status,started_at,total_pages,current_page)
    values($1,$2,$3,'Reading',now()-interval '7 days',364,273)`, [sessionId, owner, bookId(99)]);
}

export async function rpc(db, name, args = []) {
  await db.exec('savepoint rpc_call');
  try {
    const result = (await db.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result;
    await db.exec('release savepoint rpc_call');
    return result;
  } catch (error) {
    await db.exec('rollback to savepoint rpc_call; release savepoint rpc_call');
    throw error;
  }
}

export async function queue(db) {
  return (await db.query('select * from public.up_next_queue order by position')).rows;
}

export const appetite = {
  fiction_nonfiction: 'Nonfiction', avoided_genres: ['Science Fiction'], preferred_max_pages: 320,
  prefer_shorter: true, change_of_pace: true, desired_book_ids: [bookId(1)],
  context: 'Still want the long SF book, but prefer shorter nonfiction immediately.', confidence: 'High'
};
