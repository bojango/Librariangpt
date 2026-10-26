// Read-only snapshot through the existing CLI login. Never print credentials or
// reader evidence. All exported rows live under ignored output/.
import {spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const directory=resolve('output/collection-intelligence');await mkdir(directory,{recursive:true});
const plan=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','npx --yes supabase db dump --project-ref fbbpovieqfsjunmqtxvf --dry-run'],{encoding:'utf8',windowsHide:true});
if(plan.status!==0)throw new Error('Authenticated connection planning failed; credentials withheld.');
const env={...process.env,PGSSLMODE:'verify-full',PGSSLROOTCERT:resolve('output/private-collection-intelligence-backup/backup-trust-roots.pem')};
for(const [,key,value] of (plan.stdout || '').matchAll(/^export (PG\w+)="([^"]*)"/gm))env[key]=value;
if(!env.PGPASSWORD||env.PGHOST!=='aws-1-eu-west-1.pooler.supabase.com')throw new Error('Unexpected connection target.');
const sql=`set role postgres;begin isolation level repeatable read read only;
select jsonb_build_object(
'books',(select jsonb_agg(to_jsonb(b)||jsonb_build_object('authors',coalesce((select string_agg(a.name,', ' order by ba.author_order) from public.book_authors ba join public.authors a on a.id=ba.author_id where ba.book_id=b.id),''))) from public.books b),
'series',(select coalesce(jsonb_agg(s),'[]') from public.series s),
'book_series',(select coalesce(jsonb_agg(s),'[]') from public.book_series s),
'tables',(select jsonb_object_agg(name,rows) from (values ${['collection_catalogue_books','collections','collection_memberships','library_entries','recommendations','reading_paths','reading_path_entries','reading_feedback','taste_profile','taste_evidence','reading_sessions','progress_logs'].map(name=>`('${name}',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.${name} t))`).join(',')}) t(name,rows)),
'owner',(select owner_user_id from private.app_state where singleton));commit;`;
const result=spawnSync(resolve('output/postgresql-tools/pgsql/bin/psql.exe'),['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',sql],{env,encoding:'utf8',windowsHide:true,maxBuffer:30*1024*1024});
if(result.status!==0)throw new Error('Read-only snapshot failed: '+String(result.stderr || result.error).replaceAll(env.PGPASSWORD,'[redacted]').slice(-1000));
const snapshot=JSON.parse(result.stdout.trim());await writeFile(`${directory}/snapshot.json`,JSON.stringify(snapshot));
console.log(JSON.stringify({snapshot:'output/collection-intelligence/snapshot.json',works:snapshot.tables.collection_catalogue_books.length,books:snapshot.books.length,protected_tables:Object.keys(snapshot.tables).length}));
