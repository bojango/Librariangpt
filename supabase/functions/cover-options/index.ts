import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...CORS,'Content-Type':'application/json'}});
const clean=(v:any)=>String(v??'').replace(/[^0-9Xx]/g,'').toUpperCase();
function valid(i:string){if(/^\d{13}$/.test(i)){const s=i.slice(0,12).split('').reduce((a,c,n)=>a+Number(c)*(n%2?3:1),0);return(10-s%10)%10===Number(i[12])}if(/^\d{9}[\dX]$/.test(i)){let s=0;for(let n=0;n<10;n++)s+=(i[n]==='X'?10:Number(i[n]))*(10-n);return s%11===0}return false}
async function fj(url:string,ms=7500){const c=new AbortController(),t=setTimeout(()=>c.abort(),ms);try{const r=await fetch(url,{signal:c.signal,headers:{'User-Agent':'ReadingRoom/7.0 cover resolver'}});if(!r.ok)return null;return await r.json()}catch{return null}finally{clearTimeout(t)}}
function push(list:any[],seen:Set<string>,url:any,provider:string,label:string,exact:boolean){if(!url)return;const u=String(url).replace(/^http:/,'https:');if(seen.has(u))return;seen.add(u);list.push({provider,source_label:label,source_url:u,exact_edition:exact});}
function ids(v:any){return(Array.isArray(v?.industryIdentifiers)?v.industryIdentifiers:[]).map((x:any)=>clean(x?.identifier)).filter(valid)}
async function google(query:string,key:string|null){const make=(k:string|null)=>{const u=new URL('https://www.googleapis.com/books/v1/volumes');u.searchParams.set('q',query);u.searchParams.set('maxResults','20');u.searchParams.set('projection','full');if(k)u.searchParams.set('key',k);return u.toString()};let d=await fj(make(key));if((!d||!Array.isArray(d?.items)||!d.items.length)&&key)d=await fj(make(null));return d}
Deno.serve(async(req:Request)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});if(req.method!=='POST')return json({error:'POST required'},405);try{
 const auth=req.headers.get('Authorization');if(!auth)return json({error:'Authentication required'},401);const url=Deno.env.get('SUPABASE_URL')!,anon=Deno.env.get('SUPABASE_ANON_KEY')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;const user=createClient(url,anon,{global:{headers:{Authorization:auth}}});const ud=await user.auth.getUser();if(ud.error||!ud.data.user)return json({error:'Invalid session'},401);const own=await user.rpc('is_library_owner');if(own.error||own.data!==true)return json({error:'Not authorized'},403);
 const body=await req.json();const bookId=String(body?.book_id||''),refresh=body?.refresh===true;if(!bookId)return json({error:'book_id required'},400);const admin=createClient(url,service);
 const savedFirst=await admin.from('book_cover_candidates').select('*').eq('book_id',bookId).order('selected',{ascending:false}).order('exact_edition',{ascending:false}).order('updated_at',{ascending:false}).limit(30);
 const usableSaved=(savedFirst.data||[]).filter((x:any)=>x?.source_url&&(!String(x.provider||'').includes('Open Library')||!String(x.source_label||'').includes('ISBN cover')));
 if(!refresh&&usableSaved.length>=4)return json({ok:true,cached:true,candidates:savedFirst.data});
 const q=await admin.from('v_library').select('id,title,authors,ownership_status,isbn10,isbn13,display_edition_id,cover_url').eq('id',bookId).single();if(q.error||!q.data)return json({error:'Book not found'},404);const b=q.data;const bookIsbn=clean(b.isbn13||b.isbn10);const author=String(b.authors||'').split(',')[0].trim();const ownedExact=b.ownership_status==='Owned'&&valid(bookIsbn);const out:any[]=[];const seen=new Set<string>();push(out,seen,b.cover_url,'Current','Current cover',ownedExact);
 const key=Deno.env.get('GOOGLE_BOOKS_API_KEY')||null;
 if(valid(bookIsbn)){
   const [ol,g]=await Promise.all([fj(`https://openlibrary.org/isbn/${encodeURIComponent(bookIsbn)}.json`),google(`isbn:${bookIsbn}`,key)]);
   for(const cid of(Array.isArray(ol?.covers)?ol.covers:[]))if(Number(cid)>0)push(out,seen,`https://covers.openlibrary.org/b/id/${cid}-L.jpg?default=false`,'Open Library','Exact ISBN cover',true);
   for(const item of(Array.isArray(g?.items)?g.items:[])){const v=item?.volumeInfo||{},exact=ids(v).includes(bookIsbn),links=v?.imageLinks||{};for(const [k,u] of Object.entries(links))push(out,seen,u,'Google Books',`${exact?'Exact ISBN':'Related edition'} · ${k}`,exact);}
 }
 if(!ownedExact||out.length<5){
   const ols=new URL('https://openlibrary.org/search.json');ols.searchParams.set('title',b.title);if(author)ols.searchParams.set('author',author);ols.searchParams.set('limit','12');ols.searchParams.set('fields','key,title,cover_i,edition_key,isbn');
   const [sr,g]=await Promise.all([fj(ols.toString()),google(`intitle:"${b.title}"${author?` inauthor:"${author}"`:''}`,key)]);
   for(const d of(Array.isArray(sr?.docs)?sr.docs:[]))if(Number(d?.cover_i)>0)push(out,seen,`https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg?default=false`,'Open Library','Title/author edition',false);
   for(const item of(Array.isArray(g?.items)?g.items:[])){const v=item?.volumeInfo||{},exact=valid(bookIsbn)&&ids(v).includes(bookIsbn),links=v?.imageLinks||{};for(const [k,u] of Object.entries(links))push(out,seen,u,'Google Books',`${exact?'Exact ISBN':'Title/author'} · ${k}`,exact);}
 }
 const rows=out.slice(0,30).map(x=>({...x,book_id:bookId,edition_id:b.display_edition_id||null,updated_at:new Date().toISOString()}));if(rows.length)await admin.from('book_cover_candidates').upsert(rows,{onConflict:'book_id,source_url'});
 const saved=await admin.from('book_cover_candidates').select('*').eq('book_id',bookId).order('selected',{ascending:false}).order('exact_edition',{ascending:false}).order('updated_at',{ascending:false}).limit(30);return json({ok:true,cached:false,candidates:saved.data||[]});
 }catch(e){console.error(e);return json({error:(e as any)?.message||'Cover lookup failed'},500)}});
