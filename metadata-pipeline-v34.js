import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const KEY='reading-room-pending-enrichment';
let running=false;

function readPending(){try{return JSON.parse(sessionStorage.getItem(KEY)||'{}')||{};}catch{return{};}}
function writePending(value){try{sessionStorage.setItem(KEY,JSON.stringify(value));}catch{}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function refreshApp(){
  await window.LibraryDataCache?.clear?.();
  const button=document.querySelector('#refresh');
  if(button){button.click();return;}
  window.dispatchEvent(new CustomEvent('library-data-updated'));
}

async function watch(){
 if(running)return;running=true;
 try{
  const started=Date.now();
  while(Date.now()-started<150000){
   const pending=readPending(),ids=Object.keys(pending);
   if(!ids.length)return;
   const {data,error}=await supabase.from('books').select('id,metadata_status,editions_status,updated_at').in('id',ids);
   if(error){await sleep(3500);continue;}
   let changed=false,finishedAny=false;
   for(const row of data||[]){
    const metadataDone=!['unresolved','resolving'].includes(row.metadata_status||'unresolved');
    const editionsDone=!['unresolved','refreshing'].includes(row.editions_status||'unresolved');
    if(metadataDone&&editionsDone){delete pending[row.id];changed=true;finishedAny=true;}
   }
   if(changed)writePending(pending);
   if(finishedAny)await refreshApp();
   if(!Object.keys(pending).length)return;
   await sleep(3000);
  }
 }finally{running=false;}
}

window.addEventListener('load',()=>setTimeout(watch,900));
window.addEventListener('focus',()=>setTimeout(watch,250));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(watch,250);});
window.addEventListener('library-data-updated',()=>setTimeout(watch,400));
