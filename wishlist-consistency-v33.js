import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const app=document.querySelector('#app');
const GUARD='reading-room-wishlist-reload-v33';
let checking=false;

function currentWishlistIds(){
  if(!app?.querySelector('.nav-btn.active[data-nav="wishlist"]'))return null;
  return new Set([...app.querySelectorAll('.library-grid .book-card[data-book-id]')].map(x=>x.dataset.bookId).filter(Boolean));
}
function sameSet(a,b){if(a.size!==b.size)return false;for(const x of a)if(!b.has(x))return false;return true;}

async function verifyWishlist(){
  if(checking)return;
  const visible=currentWishlistIds();if(!visible)return;
  checking=true;
  try{
    const {data:{session}}=await supabase.auth.getSession();if(!session)return;
    const {data,error}=await supabase.from('v_library').select('id').eq('overall_status','Wishlist').order('title');
    if(error)return;
    const live=new Set((data||[]).map(x=>x.id));
    if(sameSet(visible,live)){sessionStorage.removeItem(GUARD);return;}
    console.info('[Reading Room] Wishlist render differed from Supabase; repairing app state.',{rendered:visible.size,live:live.size});
    if(sessionStorage.getItem(GUARD)==='1')return;
    sessionStorage.setItem(GUARD,'1');
    await window.LibraryDataCache?.clear?.();
    location.reload();
  }finally{checking=false;}
}

function schedule(delay=180){setTimeout(verifyWishlist,delay);}
document.addEventListener('click',e=>{if(e.target.closest('[data-nav="wishlist"]'))schedule(220);},{capture:false});
window.addEventListener('pageshow',()=>schedule(500));
window.addEventListener('library-data-updated',()=>{sessionStorage.removeItem(GUARD);schedule(250);});
if(document.readyState==='complete')schedule(700);else window.addEventListener('load',()=>schedule(700));
