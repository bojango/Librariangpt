import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { hasValidSchedulerCredentials } from '../_shared/enrichment-queue.js';
import { enrichCatalogueWork } from '../_shared/catalogue-enrichment.js';
import { authorityUrl } from '../_shared/collection-providers.js';
import { parseRetryAfter } from '../_shared/provider-fetch.js';
import { collectionArtwork } from '../_shared/catalogue-artwork.js';
const headers={'Content-Type':'application/json'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
const authorHosts=['prestonchild.com','dennisetaylor.org','hughhowey.com','michaelcrichton.com','alastairreynolds.com','adriantchaikovsky.com','andyweirauthor.com'];
const imageHosts=['covers.openlibrary.org','archive.org','books.google.com','books.google.co.uk','books.googleusercontent.com','images-na.ssl-images-amazon.com','images.macmillan.com','images.penguinrandomhouse.com','m.media-amazon.com','i0.wp.com','fbbpovieqfsjunmqtxvf.supabase.co',...authorHosts];
function allowed(url:string,kind:string) {
 try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&Boolean(kind==='image'?(imageHosts.some(h=>u.hostname===h||u.hostname.endsWith(`.${h}`))||authorityUrl(url)):kind==='document'?authorityUrl(url,authorHosts):['openlibrary.org','www.googleapis.com'].includes(u.hostname));}catch{return false;}
}
export function providerRequest(admin:any) {
 const deadline=Date.now()+45000;
 return async(url:string,kind:string)=>{
  if(!allowed(url,kind))throw new Error('Untrusted provider URL');
  const host=new URL(url).hostname;
  // Image delivery has a different quota from the Books search API. Cached
  // edition artwork must remain verifiable while search is rate limited.
  const provider=kind==='image'?(host.includes('openlibrary.org')||host.endsWith('archive.org')?'catalogue_open_library_covers':host.includes('google')?'catalogue_google_covers':'catalogue_publisher_images'):host==='www.googleapis.com'?'google_books':host==='openlibrary.org'?'collection_open_library':'catalogue_publisher';
  const state=await admin.from('enrichment_provider_state').select('retry_after').eq('provider',provider).maybeSingle();
  if(state.error)throw state.error;
  if(Date.parse(state.data?.retry_after || '')>Date.now())throw Object.assign(new Error('Provider circuit is open'),{retryAfter:state.data.retry_after});
  let target=new URL(url);if(target.hostname==='www.googleapis.com'&&Deno.env.get('GOOGLE_BOOKS_API_KEY'))target.searchParams.set('key',Deno.env.get('GOOGLE_BOOKS_API_KEY')!);
  let response:Response;
  for(let n=0;;n++){
   const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Provider time budget exhausted');
   response=await fetch(target.href,{redirect:'manual',signal:AbortSignal.timeout(Math.min(7000,remaining)),headers:{Accept:kind==='image'?'image/jpeg,image/png,image/webp':kind==='document'?'text/html':'application/json','User-Agent':'ReadingRoom/1.0 (personal catalogue enrichment)'}});
   if(response.status<300||response.status>=400)break;
   const next=new URL(response.headers.get('Location') || '',target);
   if(n>=2||!response.headers.get('Location')||!allowed(next.href,kind))throw new Error('Untrusted provider redirect');target=next;
  }
  if(response.status===429||response.status===503){
   const retryAfter=new Date(Date.now()+1000*Math.max(60,parseRetryAfter(response.headers.get('Retry-After')) || 3600)).toISOString();
   const saved=await admin.rpc('extend_enrichment_provider_backoff',{p_provider:provider,p_retry_after:retryAfter,p_diagnostic:{http_status:response.status}});if(saved.error)throw saved.error;
   throw Object.assign(new Error(`Provider HTTP ${response.status}`),{retryAfter});
  }
  if(response.status===404)return null;if(!response.ok)throw new Error(`Provider HTTP ${response.status}`);
  const chunks:Uint8Array[]=[];let size=0;const reader=response.body?.getReader();
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>(kind==='image'?5_000_000:2_000_000)){await reader.cancel();throw new Error('Provider response too large');}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  if(kind==='image')return {bytes,type:response.headers.get('content-type') || ''};
  const text=new TextDecoder().decode(bytes);return kind==='document'?text:JSON.parse(text);
 };
}
Deno.serve(async(request:Request)=>{
 if(request.method!=='POST')return json({error:'POST required'},405);
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',authorization=request.headers.get('Authorization');
 if(!hasValidSchedulerCredentials({serviceCredential:Boolean(key)&&(authorization===`Bearer ${key}`||request.headers.get('apikey')===key),schedulerToken:Deno.env.get('ENRICHMENT_SCHEDULER_TOKEN') || '',suppliedSchedulerToken:request.headers.get('x-enrichment-scheduler-token') || '',requiresSchedulerToken:true}))return json({error:'Not authorized'},401);
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,key);
 try{
  const body=await request.json().catch(()=>({}));
  const reconciled=await admin.rpc('reconcile_collection_intelligence');if(reconciled.error)throw reconciled.error;
  const claimed=await admin.rpc('claim_catalogue_enrichment',{p_limit:Math.min(2,Math.max(1,Number(body.batch_size)||2)),p_work_key:body.work_key || null});if(claimed.error)throw claimed.error;
  const outcomes=[];
  for(const job of claimed.data || []){
   let result:any={},error:string|null=null,retryAfter:string|null=null;
   try{
    const work=await admin.from('collection_catalogue_books').select('*').eq('key',job.work_key).single();if(work.error)throw work.error;
    let canonical=null,cached:any[]=[];
    if(work.data.book_id){
     const book=await admin.from('books').select('id,synopsis,original_publication_year,cover_url_preferred,metadata_source').eq('id',work.data.book_id).single();if(book.error)throw book.error;canonical=book.data;
     const metadata=await admin.from('book_metadata_candidates').select('payload').eq('book_id',work.data.book_id);if(metadata.error)throw metadata.error;cached=(metadata.data || []).map((c:any)=>c.payload);
    }
    result=await enrichCatalogueWork(work.data,{canonical,cached,artwork:collectionArtwork[job.work_key],request:providerRequest(admin),publisherAllowed:(url:string)=>Boolean(authorityUrl(url,authorHosts))});
    retryAfter=result.retry_after || null;
    if(result.diagnostics.length&&!result.synopsis&&!result.cover_verified)error='Bibliographic providers incomplete; retry scheduled.';
   }catch(e){error='Catalogue enrichment failed; provider or database unavailable.';retryAfter=e.retryAfter || null;}
   const saved=await admin.rpc('finish_catalogue_enrichment',{p_work_key:job.work_key,p_token:job.claim_token,p_result:result,p_error:error,p_retry_after:retryAfter});if(saved.error)throw saved.error;
   outcomes.push({work_key:job.work_key,saved:saved.data,error});
  }
  return json({ok:true,revision:Deno.env.get('DENO_DEPLOYMENT_ID'),checked:outcomes.length,outcomes});
 }catch{return json({error:'Catalogue processing failed; leased jobs will recover automatically.'},500);}
});
