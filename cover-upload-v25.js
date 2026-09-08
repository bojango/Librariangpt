import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const app=document.querySelector('#app');
const modalRoot=document.querySelector('#modal-root');
const toastNode=document.querySelector('#toast');
let injecting=false;

function toast(message,error=false){if(!toastNode)return;toastNode.textContent=message;toastNode.className=`toast show${error?' error':''}`;clearTimeout(toastNode._cover25);toastNode._cover25=setTimeout(()=>toastNode.className='toast',3600);}
async function clearCaches(){try{localStorage.removeItem('library-detail-cache-v4');localStorage.removeItem('library-enrichment-v4');}catch{}await window.LibraryDataCache?.clear?.();}
function currentBookId(){return app?.querySelector('.detail-header[data-book-id]')?.dataset.bookId||null;}
async function fetchBook(bookId){const {data,error}=await supabase.from('v_library').select('id,title,authors,ownership_status,display_edition_id,current_edition_id,reference_edition_id').eq('id',bookId).single();if(error)throw error;return data;}
async function ensureEdition(book){
 let editionId=book.display_edition_id||book.current_edition_id||book.reference_edition_id||null;if(editionId)return editionId;
 const {data,error}=await supabase.functions.invoke('book-metadata',{body:{book_id:book.id,title:book.title,author:String(book.authors||'').split(',')[0].trim()||null,owned:false,set_preferred:false}});if(error)throw error;if(data?.error)throw new Error(data.error);
 editionId=data?.edition_id||null;if(!editionId)throw new Error('No reference edition could be created for this book.');
 return editionId;
}
function fileToImage(file){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file);const img=new Image();img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read that image.'))};img.src=url;});}
async function normaliseFile(file){
 if(!file||!/^image\/(jpeg|png|webp)$/i.test(file.type))throw new Error('Choose a JPEG, PNG or WebP image.');
 const img=await fileToImage(file);const max=2000;const scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));const w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));
 const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);
 const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not process the image.')),'image/jpeg',.91));
 const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error||new Error('Could not read processed image.'));reader.readAsDataURL(blob);});
 return {dataUrl,width:w,height:h,size:blob.size};
}
async function upload(bookId,file,button){
 button.disabled=true;button.textContent='Preparing…';
 try{
  const book=await fetchBook(bookId);const editionId=await ensureEdition(book);const processed=await normaliseFile(file);
  button.textContent='Uploading…';
  const {data,error}=await supabase.functions.invoke('upload-cover-photo',{body:{book_id:bookId,edition_id:editionId,image_base64:processed.dataUrl.split(',')[1],mime_type:'image/jpeg',width:processed.width,height:processed.height,processing:'Manual image upload'}});if(error)throw error;if(data?.error)throw new Error(data.error);
  await clearCaches();toast('Cover image uploaded and saved.');window.dispatchEvent(new CustomEvent('library-data-updated'));setTimeout(()=>location.reload(),180);
 }catch(err){toast(err.message||'Could not upload cover image',true);button.disabled=false;button.textContent='Use uploaded image';}
}
function inject(){
 if(injecting||!modalRoot)return;const form=modalRoot.querySelector('#v4-custom-cover');if(!form||form.dataset.uploadV25==='1')return;injecting=true;
 try{
  form.dataset.uploadV25='1';const wrap=document.createElement('section');wrap.className='cover-upload-v25';wrap.innerHTML=`<div class="cover-upload-head"><div><strong>Upload image</strong><small>Choose a saved cover from Photos or Files. It will be resized, uploaded to Supabase and used as the selected cover.</small></div><label class="btn cover-upload-picker">Choose image<input type="file" accept="image/jpeg,image/png,image/webp" hidden data-cover-file-v25></label></div><div class="cover-upload-preview" data-cover-preview-v25 hidden><img alt="Selected cover preview"><div><span data-cover-file-name-v25></span><button class="btn btn-primary" type="button" data-cover-save-v25>Use uploaded image</button></div></div>`;
  form.before(wrap);const input=wrap.querySelector('[data-cover-file-v25]'),preview=wrap.querySelector('[data-cover-preview-v25]'),img=preview.querySelector('img'),name=wrap.querySelector('[data-cover-file-name-v25]'),save=wrap.querySelector('[data-cover-save-v25]');let selected=null,objectUrl=null;
  input.addEventListener('change',()=>{selected=input.files?.[0]||null;if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl=null;}if(!selected){preview.hidden=true;return;}if(!/^image\/(jpeg|png|webp)$/i.test(selected.type)){toast('Choose a JPEG, PNG or WebP image.',true);input.value='';return;}objectUrl=URL.createObjectURL(selected);img.src=objectUrl;name.textContent=`${selected.name} · ${(selected.size/1024/1024).toFixed(1)} MB`;preview.hidden=false;});
  save.addEventListener('click',()=>{const id=currentBookId();if(!id)return toast('Could not identify this book.',true);if(!selected)return;upload(id,selected,save);});
 }finally{injecting=false;}
}

if(modalRoot)new MutationObserver(()=>requestAnimationFrame(inject)).observe(modalRoot,{childList:true,subtree:true});
window.addEventListener('load',()=>setTimeout(inject,500));
