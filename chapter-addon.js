import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const app=document.querySelector('#app');
const CHECK_KEY='library-chapter-checks-v1';
const CHECK_RETRY=24*60*60*1000;
let busy=false;
let observerPending=false;
let currentRows=[];

function escSelector(value){return window.CSS?.escape?CSS.escape(String(value)):String(value).replace(/["\\]/g,'\\$&');}
function checks(){try{return JSON.parse(localStorage.getItem(CHECK_KEY)||'{}');}catch{return{};}}
function saveChecks(value){try{localStorage.setItem(CHECK_KEY,JSON.stringify(value));}catch{}}
function chapterLabel(book){
  const number=String(book.current_chapter_number||'').trim();
  const title=String(book.current_chapter_title||'').trim();
  const type=String(book.current_chapter_type||'chapter');
  if(!number&&!title)return'';
  if(type==='chapter'&&number){
    if(!title||title.toLowerCase()===`chapter ${number}`.toLowerCase())return `Chapter ${number}`;
    return `Chapter ${number}: ${title}`;
  }
  return title||`Chapter ${number}`;
}
function paint(book){
  const label=chapterLabel(book);if(!label||!app)return;
  const selectors=[`.hero[data-book-id="${escSelector(book.id)}"] .progress-block`,`.detail-header[data-book-id="${escSelector(book.id)}"] .progress-block`];
  selectors.forEach(selector=>app.querySelectorAll(selector).forEach(block=>{
    let line=block.querySelector('.chapter-progress-line');
    if(!line){line=document.createElement('div');line.className='chapter-progress-line';const meta=block.querySelector('.progress-meta');if(meta)meta.insertAdjacentElement('afterend',line);else block.prepend(line);}
    line.textContent=label;line.title=label;
  }));
}
function paintAll(){currentRows.forEach(paint);}
async function sync(){
  if(busy||document.hidden||!navigator.onLine)return;busy=true;
  try{
    const {data:{session}}=await supabase.auth.getSession();if(!session)return;
    let {data,error}=await supabase.from('v_library_chapters').select('id,title,overall_status,current_page,total_pages,display_edition_id,current_chapter_number,current_chapter_title,current_chapter_type,current_chapter_start_page,chapter_map_status,chapter_map_last_checked_at').eq('overall_status','Currently Reading');
    if(error||!data?.length){currentRows=[];return;}
    currentRows=data;paintAll();
    const local=checks();let changed=false;
    for(const book of data){
      if(book.current_chapter_title||!book.display_edition_id)continue;
      if(['available','manual'].includes(book.chapter_map_status||''))continue;
      const last=Math.max(Number(local[book.display_edition_id]||0),book.chapter_map_last_checked_at?new Date(book.chapter_map_last_checked_at).getTime():0);
      if(Date.now()-last<CHECK_RETRY)continue;
      local[book.display_edition_id]=Date.now();saveChecks(local);
      const {data:result,error:fnError}=await supabase.functions.invoke('chapter-map',{body:{book_id:book.id}});
      if(!fnError&&result?.imported>0)changed=true;
    }
    if(changed){
      const fresh=await supabase.from('v_library_chapters').select('id,title,overall_status,current_page,total_pages,display_edition_id,current_chapter_number,current_chapter_title,current_chapter_type,current_chapter_start_page,chapter_map_status,chapter_map_last_checked_at').eq('overall_status','Currently Reading');
      if(!fresh.error&&fresh.data){currentRows=fresh.data;paintAll();}
    }
  }catch(e){console.info('[Library] chapter mapping unavailable',e?.message||e);}finally{busy=false;}
}

if(app){new MutationObserver(()=>{if(observerPending)return;observerPending=true;requestAnimationFrame(()=>{observerPending=false;paintAll();});}).observe(app,{childList:true,subtree:true,attributes:true,attributeFilter:['data-book-id']});}
window.addEventListener('load',()=>setTimeout(sync,850));
window.addEventListener('online',()=>setTimeout(sync,400));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(sync,400);});
supabase.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(sync,500);});
