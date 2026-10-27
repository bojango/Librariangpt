import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { hasValidSchedulerCredentials } from '../_shared/enrichment-queue.js';
import { discoverWithProviders } from '../_shared/collection-discovery.js';
import { registry } from '../_shared/collection-registry.js';
import { parseRetryAfter } from '../_shared/provider-fetch.js';
import {authorityUrl} from '../_shared/collection-providers.js';
// Supabase injects project/function/version, so redeployment invalidates old
// smoke evidence even when a developer forgets to bump a semantic version.
const WORKER_REVISION=Deno.env.get('DENO_DEPLOYMENT_ID');

const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-enrichment-scheduler-token','Content-Type':'application/json'};
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers});
async function rows(admin:any,table:string,columns='*') {
  const all:any[]=[];
  for(let offset=0;;offset+=1000) {
    const column={collections:'key',collection_catalogue_books:'key',collection_memberships:'collection_key',collection_source_catalogues:'key'}[table] || (['book_series','book_authors'].includes(table)?'book_id':'id');
    let query=admin.from(table).select(columns).order(column);
    if(table==='book_series') query=query.order('series_id');
    if(table==='book_authors') query=query.order('author_id');
    if(table==='collection_memberships') query=query.order('work_key');
    const result=await query.range(offset,offset+999);
    if(result.error) throw result.error;
    all.push(...(result.data || []));
    if(!result.data || result.data.length<1000) return all;
  }
}
export async function loadSnapshot(admin:any) {
  const [books,editions,authors,links,series,book_series,external,collections,works,memberships,sources]=await Promise.all([
    rows(admin,'books','id,title,original_publication_year,cover_url_preferred'),
    rows(admin,'editions','id,book_id,isbn13,isbn10,open_library_work_id,open_library_edition_id,metadata_payload,cover_url'),
    rows(admin,'authors','id,name'),rows(admin,'book_authors','book_id,author_id,author_order'),rows(admin,'series'),rows(admin,'book_series'),rows(admin,'book_external_ids','id,book_id,provider,external_id,url'),
    rows(admin,'collections'),rows(admin,'collection_catalogue_books'),rows(admin,'collection_memberships'),rows(admin,'collection_source_catalogues')
  ]);
  return {books:books.map(b=>({...b,authors:links.filter(l=>l.book_id===b.id).sort((a,b)=>a.author_order-b.author_order).map(l=>authors.find(a=>a.id===l.author_id)?.name).filter(Boolean).join(', '),editions:editions.filter(e=>e.book_id===b.id),external_ids:external.filter(e=>e.book_id===b.id)})),series,book_series,collections,works,memberships,sources};
}

async function providerJson(admin:any,url:string,document=false,deadline=Date.now()+20000) {
  if(Date.now()>=deadline) throw new Error('Collection provider discovery time budget exhausted.');
  const provider=url.startsWith('https://www.googleapis.com/books/')?'google_books':url.startsWith('https://openlibrary.org/')?'collection_open_library':'collection_publisher';
  const circuit=await admin.from('enrichment_provider_state').select('retry_after').eq('provider',provider).maybeSingle();
  if(circuit.error) throw circuit.error;
  if(Date.parse(circuit.data?.retry_after || '')>Date.now()) throw Object.assign(new Error('Collection provider circuit is open.'),{retryAfter:circuit.data.retry_after});
  let target=new URL(url);
  if(provider==='google_books'&&Deno.env.get('GOOGLE_BOOKS_API_KEY')) target.searchParams.set('key',Deno.env.get('GOOGLE_BOOKS_API_KEY')!);
  let response:Response;
  for(let redirects=0;;redirects++) {
    const remaining=deadline-Date.now();if(remaining<=0) throw new Error('Collection provider discovery time budget exhausted.');
    response=await fetch(target.href,{redirect:'manual',signal:AbortSignal.timeout(Math.min(6500,remaining)),headers:{Accept:document?'text/html,application/ld+json':'application/json','User-Agent':'ReadingRoom/1.0 (collection discovery)'}});
    if(response.status<300||response.status>=400) break;
    const location=response.headers.get('Location');
    if(redirects>=2||!location) throw new Error('Collection provider redirect limit.');
    const next=new URL(location,target);
    if(next.protocol!=='https:'||next.username||next.password||next.port||(provider==='collection_publisher'?!authorityUrl(next.href):next.hostname!==target.hostname)) throw new Error('Untrusted collection provider redirect.');
    target=next;
  }
  if(response.status===429 || response.status===503) {
    const seconds=Math.max(60,parseRetryAfter(response.headers.get('Retry-After')) || 2700);
    const retryAfter=new Date(Date.now()+seconds*1000).toISOString();
    const saved=await admin.rpc('extend_enrichment_provider_backoff',{p_provider:provider,p_retry_after:retryAfter,p_diagnostic:{http_status:response.status}});
    if(saved.error) throw saved.error;
    throw Object.assign(new Error(`Collection provider HTTP ${response.status}.`),{retryAfter});
  }
  if(response.status===404) return null;
  if(!response.ok) throw new Error(`Collection provider HTTP ${response.status}.`);
  const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader) for(;;) {
    const {done,value}=await reader.read();if(done) break;
    size+=value.length;if(size>2_000_000) {await reader.cancel();throw new Error('Collection provider response exceeds limit.');}chunks.push(value);
  }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const text=new TextDecoder().decode(bytes);
  return document?text:JSON.parse(text);
}

Deno.serve(async(request:Request)=>{
  if(request.method==='OPTIONS') return new Response('ok',{headers});
  if(request.method!=='POST') return json({error:'POST required'},405);
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authorization=request.headers.get('Authorization') || '';
  // Discovery writes global bibliographic data: owner clients queue through DB
  // identity triggers; only service/scheduler credentials may run this worker.
  const body=await request.json().catch(()=>({}));
  if(!hasValidSchedulerCredentials({serviceCredential:Boolean(key)&&(authorization===`Bearer ${key}` || request.headers.get('apikey')===key),schedulerToken:Deno.env.get('ENRICHMENT_SCHEDULER_TOKEN') || '',suppliedSchedulerToken:request.headers.get('x-enrichment-scheduler-token') || '',requiresSchedulerToken:true})) return json({error:'Not authorized'},401);
  const admin=createClient(url,key);
  try {
    if(body.smoke_test===true&&(!WORKER_REVISION||!body.book_id)) return json({error:'Smoke evidence requires a hosted deployment identity and an explicit book_id.'},503);
    const refreshed=await admin.rpc('refresh_collection_registry',{p_revision:registry.revision});
    if(refreshed.error) throw refreshed.error;
    const claimed=await admin.rpc('claim_collection_discovery',{p_limit:Math.min(4,Math.max(1,Number(body.batch_size)||2)),p_book_id:body.book_id || null});
    if(claimed.error) throw claimed.error;
    if(!claimed.data?.length) return json({ok:true,checked:0});
    const work=(async()=>{
      let snapshot:any;
      for(const job of claimed.data) {
        const args={p_book_id:job.book_id,p_token:job.claim_token,p_revision:job.revision};
        try {
          snapshot ||= await loadSnapshot(admin);
          const book=snapshot.books.find((b:any)=>b.id===job.book_id);
          if(!book) throw new Error('Canonical book disappeared during discovery.');
          const deadline=Date.now()+20000;
          const result=await discoverWithProviders(book,snapshot,registry,{fetchJson:(url:string)=>providerJson(admin,url,false,deadline),fetchDocument:(url:string)=>providerJson(admin,url,true,deadline)});
          result.registry_revision=registry.revision;
          if(result.source_catalogue) {
            const source=await admin.from('collection_source_catalogues').upsert({...result.source_catalogue,verified_at:new Date().toISOString()},{onConflict:'key'});
            if(source.error) throw source.error;
            snapshot.sources.push(result.source_catalogue);
          }
          const saved=await admin.rpc('finish_collection_discovery',{...args,p_result:result});
          if(saved.error) throw saved.error;
          const smokeRequested=body.smoke_test===true&&body.book_id===job.book_id&&saved.data===true&&result.status!=='unresolved';
          const completed=smokeRequested?await admin.from('collection_discovery_jobs').select('status').eq('book_id',job.book_id).maybeSingle():null;
          if(completed?.error) throw completed.error;
          if(smokeRequested&&completed?.data?.status==='completed') {
            const smoke=await admin.from('collection_worker_smoke').upsert({singleton:true,worker_revision:WORKER_REVISION,book_id:job.book_id,tested_at:new Date().toISOString()},{onConflict:'singleton'});
            if(smoke.error) throw smoke.error;
          }
        } catch(error:any) {
          console.error('Collection discovery failed',{book_id:job.book_id,attempt:job.attempt_count,error:error.message});
          const failed=await admin.rpc('finish_collection_discovery',{...args,p_result:{failed_at:new Date().toISOString()},p_error:error.message || String(error),p_retry_after:error.retryAfter || null});
          if(failed.error) console.error('Could not persist collection failure',{book_id:job.book_id,error:failed.error.message});
        }
      }
    })();
    const runtime:any=(globalThis as any).EdgeRuntime;
    if(runtime?.waitUntil) runtime.waitUntil(work); else await work;
    return json({ok:true,accepted:true,checked:claimed.data.length},202);
  } catch(error:any) {console.error('Collection worker failed',error.message);return json({error:error.message},500);}
});
