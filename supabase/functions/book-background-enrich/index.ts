import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...CORS,'Content-Type':'application/json'}});

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return json({error:'POST required'},405);
  try{
    const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,auth=req.headers.get('Authorization');
    if(!auth)return json({error:'Authentication required'},401);
    const user=createClient(url,anon,{global:{headers:{Authorization:auth}}});const ud=await user.auth.getUser();if(ud.error||!ud.data.user)return json({error:'Invalid session'},401);const own=await user.rpc('is_library_owner');if(own.error||own.data!==true)return json({error:'Not authorized'},403);
    const body=await req.json(),bookId=String(body?.book_id||'');if(!bookId)return json({error:'book_id required'},400);
    const admin=createClient(url,service);const exists=await admin.from('books').select('id').eq('id',bookId).maybeSingle();if(!exists.data)return json({error:'Book not found'},404);
    await admin.from('books').update({metadata_status:'resolving',editions_status:'refreshing',metadata_error:null,editions_error:null}).eq('id',bookId);
    await admin.from('library_events').insert({user_id:ud.data.user.id,book_id:bookId,event_type:'background_enrichment_started',source:'frontend',payload:{started_at:new Date().toISOString()}});

    const headers={Authorization:auth,apikey:anon,'Content-Type':'application/json'};
    const call=async(slug:string,payload:any)=>{try{const r=await fetch(`${url}/functions/v1/${slug}`,{method:'POST',headers,body:JSON.stringify(payload)});const data=await r.json().catch(()=>null);return{slug,ok:r.ok,data}}catch(e){return{slug,ok:false,error:e?.message||String(e)}}};
    const work=(async()=>{
      const results=await Promise.allSettled([
        call('content-enrichment',{book_id:bookId,force:true}),
        call('edition-options',{book_id:bookId,force:true})
      ]);
      const detail=results.map((x:any)=>x.status==='fulfilled'?x.value:{ok:false,error:x.reason?.message||String(x.reason)});
      await admin.from('library_events').insert({user_id:ud.data.user.id,book_id:bookId,event_type:'background_enrichment_finished',source:'background',payload:{finished_at:new Date().toISOString(),results:detail}}).catch(()=>null);
    })();
    // Supabase Edge background task survives after the HTTP response is returned.
    // deno-lint-ignore no-explicit-any
    const runtime:any=(globalThis as any).EdgeRuntime;
    if(runtime?.waitUntil)runtime.waitUntil(work);else await work;
    return json({ok:true,accepted:true,book_id:bookId,status:'background'} ,202);
  }catch(e){console.error(e);return json({error:e?.message||'Could not start enrichment'},500)}
});
