import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const toastNode=document.querySelector('#toast');

function toast(message,error=false){
  if(!toastNode)return;
  toastNode.textContent=message;
  toastNode.className=`toast show${error?' error':''}`;
  clearTimeout(toastNode._metadataRefresh);
  toastNode._metadataRefresh=setTimeout(()=>toastNode.className='toast',4800);
}

async function edgeMessage(error){
  try{
    const response=error?.context;
    if(response instanceof Response){
      const body=await response.clone().json();
      return body?.message||body?.error||null;
    }
  }catch{}
  return error?.message||null;
}

async function clearBookCaches(){
  try{localStorage.removeItem('library-detail-cache-v4');}catch{}
  try{localStorage.removeItem('library-enrichment-v4');}catch{}
  try{await window.LibraryDataCache?.clear?.();}catch{}
}

async function refreshBookData(button){
  const bookId=button.dataset.v4RefreshData;
  if(!bookId||button.dataset.refreshBusy==='1')return;
  const original=button.textContent;
  button.dataset.refreshBusy='1';
  button.disabled=true;
  button.textContent='Refreshing…';
  try{
    const {data,error}=await supabase.functions.invoke('content-enrichment',{body:{book_id:bookId,force:true}});
    if(error)throw error;
    await clearBookCaches();

    if(data?.ok===false){
      toast(data.message||'No reliable metadata match was found. Existing data was left unchanged.');
      return;
    }

    toast(data?.message||'Book data refreshed.');
    window.dispatchEvent(new CustomEvent('library-data-updated',{detail:{book_id:bookId,source:'metadata-refresh'}}));
    setTimeout(()=>document.querySelector('#refresh')?.click(),120);
  }catch(error){
    const message=await edgeMessage(error);
    toast(message||'Book data refresh failed. Try again shortly.',true);
  }finally{
    button.dataset.refreshBusy='0';
    button.disabled=false;
    button.textContent=original;
  }
}

document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-v4-refresh-data]');
  if(!button)return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  refreshBookData(button);
},true);
