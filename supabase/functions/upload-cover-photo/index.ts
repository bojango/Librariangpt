import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { MAX_COVER_BYTES, validateCoverBytes } from '../_shared/cover-image.js';

const CORS={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
 'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...CORS,'Content-Type':'application/json'}});

function decodeBase64(input:string){
 const raw=atob(input);const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;
}

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
 if(req.method!=='POST')return json({error:'POST required'},405);
 try{
  const auth=req.headers.get('Authorization');if(!auth)return json({error:'Authentication required'},401);
  const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const user=createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const ud=await user.auth.getUser();if(ud.error||!ud.data.user)return json({error:'Invalid session'},401);
  const own=await user.rpc('is_library_owner');if(own.error||own.data!==true)return json({error:'Not authorized'},403);
  const admin=createClient(url,service);
  const body=await req.json();
  const bookId=String(body?.book_id||''),editionId=String(body?.edition_id||''),mime=String(body?.mime_type||'image/jpeg').toLowerCase();
  const base64=String(body?.image_base64||'').replace(/^data:[^;]+;base64,/,''),processing=String(body?.processing||'Uploaded image');
  const width=Number(body?.width||0)||null,height=Number(body?.height||0)||null;
  if(!bookId||!base64)return json({error:'book_id and image are required'},400);
  if(!['image/jpeg','image/png','image/webp'].includes(mime))return json({error:'Unsupported image type'},400);
  const entry=await admin.from('library_entries').select('book_id').eq('book_id',bookId).eq('user_id',ud.data.user.id).single();if(entry.error||!entry.data)return json({error:'Book not found in your library'},404);
  let ed:any=null;
  if(editionId){ed=await admin.from('editions').select('id,book_id,owned').eq('id',editionId).eq('book_id',bookId).single();if(ed.error||!ed.data)return json({error:'Edition not found'},404);}
  if(base64.length>Math.ceil(MAX_COVER_BYTES/3)*4)return json({error:'Processed cover is too large (maximum 5 MB)'},413);
  let bytes:Uint8Array;
  try{bytes=decodeBase64(base64);validateCoverBytes(bytes,mime);}catch{return json({error:'Invalid image or image exceeds 5 MB'},422);}
  const ext=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';
  const path=`${bookId}/${editionId||'book'}-${crypto.randomUUID()}.${ext}`;
  const up=await admin.storage.from('book-covers').upload(path,bytes,{contentType:mime,cacheControl:'31536000',upsert:true});if(up.error)throw up.error;
  const publicUrl=admin.storage.from('book-covers').getPublicUrl(path).data.publicUrl+`?v=${Date.now()}`;
  const exactEdition=Boolean(ed?.data?.owned);
  const saved=await admin.rpc('save_cover_selection',{p_user_id:ud.data.user.id,p_book_id:bookId,p_edition_id:editionId||null,p_url:publicUrl,p_provider:'Uploaded image',p_label:processing,p_uploaded:true,p_lock:true,p_width:width,p_height:height});
  if(saved.error){await admin.storage.from('book-covers').remove([path]);throw saved.error;}
  return json({ok:true,book_id:bookId,edition_id:editionId,cover_url:publicUrl,exact_edition:exactEdition,width,height});
 }catch(e){console.error(e);return json({error:e?.message||'Could not save cover image'},500)}
});
