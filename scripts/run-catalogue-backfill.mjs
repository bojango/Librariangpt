// Bounded, sequential invocation of the deployed queue. Vault secrets never
// leave the database. No Library, recommendation or assessment writes here.
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const max=Math.min(100,Math.max(1,Number(process.argv[2])||90));
const env={...process.env,PGSSLMODE:'verify-full',PGSSLROOTCERT:resolve('output/private-collection-intelligence-backup/backup-trust-roots.pem')};
let connectionStarted=0;
function refreshConnection(){
 const plan=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','npx --yes supabase db dump --project-ref fbbpovieqfsjunmqtxvf --dry-run'],{encoding:'utf8',windowsHide:true});
 if(plan.status!==0)throw new Error('Connection planning failed; credentials withheld.');
 for(const [,key,value] of (plan.stdout || '').matchAll(/^export (PG\w+)="([^"]*)"/gm))env[key]=value;
 if(!env.PGPASSWORD||env.PGHOST!=='aws-1-eu-west-1.pooler.supabase.com')throw new Error('Unexpected connection target.');connectionStarted=Date.now();
}
function sql(query){
 if(Date.now()-connectionStarted>180000)refreshConnection();
 const r=spawnSync(resolve('output/postgresql-tools/pgsql/bin/psql.exe'),['-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c','set role postgres;'+query],{env,encoding:'utf8',windowsHide:true,maxBuffer:5*1024*1024});
 if(r.status!==0)throw new Error('Database operation failed: '+String(r.stderr || '').replaceAll(env.PGPASSWORD,'[redacted]').slice(-400));return r.stdout.trim();
}
const evidence=[];
for(let batch=0;batch<max;batch++){
 const queued=Number(sql("select count(*) from public.catalogue_enrichment_jobs where status='queued' and available_at<=now()"));if(!queued)break;
 const id=Number(sql(`select net.http_post(url:=(select decrypted_secret from vault.decrypted_secrets where name='project_url')||'/functions/v1/catalogue-enrichment',headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||(select decrypted_secret from vault.decrypted_secrets where name='goodreads_scheduler_service_key'),'apikey',(select decrypted_secret from vault.decrypted_secrets where name='goodreads_scheduler_service_key'),'x-enrichment-scheduler-token',(select decrypted_secret from vault.decrypted_secrets where name='enrichment_scheduler_token')),body:='{"batch_size":2}'::jsonb,timeout_milliseconds:=110000)`));
 let response=null;
 for(let poll=0;poll<60;poll++){await delay(2000);const text=sql(`select jsonb_build_object('status',status_code,'content',content,'timed_out',timed_out) from net._http_response where id=${id}`);if(text){response=JSON.parse(text);break;}}
 if(response?.status!==200||response.timed_out)throw new Error(`Backfill stopped after worker failure (request ${id}). Existing reader data is unchanged.`);
 const result=JSON.parse(response.content);evidence.push({request_id:id,...result});
 await writeFile('output/collection-intelligence/backfill.json',JSON.stringify(evidence,null,2));
 console.log(JSON.stringify({batch:batch+1,checked:result.checked,queued_before:queued,errors:result.outcomes?.filter(o=>o.error).length || 0}));
 if(!result.checked)break;
 await delay(1500);
}
console.log(JSON.stringify({finished:true,coverage:JSON.parse(sql("select jsonb_build_object('works',count(*),'covers',count(cover_url),'verified_covers',count(cover_verified_at),'synopses',count(synopsis)) from public.collection_catalogue_books"))}));
