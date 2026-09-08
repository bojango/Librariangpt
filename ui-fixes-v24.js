import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const app=document.querySelector('#app');
const modalRoot=document.querySelector('#modal-root');
const toastNode=document.querySelector('#toast');
let observerQueued=false;
let reroutingFilter=false;

const esc=(v='')=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
function toast(message,error=false){if(!toastNode)return;toastNode.textContent=message;toastNode.className=`toast show${error?' error':''}`;clearTimeout(toastNode._v24);toastNode._v24=setTimeout(()=>toastNode.className='toast',3600);}
function closeModal(){if(modalRoot)modalRoot.innerHTML='';}
function modal(html){modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal add-book-modal-v24">${html}</div></div>`;modalRoot.querySelectorAll('[data-v24-close]').forEach(b=>b.addEventListener('click',closeModal));modalRoot.querySelector('.modal-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();});}
async function fn(name,body){const {data,error}=await supabase.functions.invoke(name,{body});if(error)throw error;if(data?.error)throw new Error(data.error);return data;}
async function clearCaches(){try{localStorage.removeItem('library-detail-cache-v4');localStorage.removeItem('library-enrichment-v4');}catch{}await window.LibraryDataCache?.clear?.();}
function scrollTopNow(){requestAnimationFrame(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));}

function patchHeader(){
 const word=app?.querySelector('.wordmark');if(!word||word.dataset.homeLinkV24==='1')return;
 word.dataset.homeLinkV24='1';word.setAttribute('role','link');word.setAttribute('tabindex','0');word.setAttribute('aria-label','Go to Library home');
 const go=()=>{const home=app.querySelector('.nav-btn[data-nav="home"]');home?.click();scrollTopNow();};
 word.addEventListener('click',go);word.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();go();}});
}

function patchAdminStatus(){
 app?.querySelectorAll('.detail-header[data-book-id]').forEach(detail=>{
  const target=detail.querySelector('.book-admin-entry strong');if(!target)return;
  const values=[...detail.querySelectorAll('.detail-copy .meta .badge')].map(x=>x.textContent?.trim()).filter(Boolean);
  if(values.length)target.textContent=values.join(' · ');
 });
}

function patchAddButtons(){
 const toolbar=app?.querySelector('.toolbar');
 if(toolbar){
  [...toolbar.querySelectorAll('button')].filter(b=>b.textContent?.trim()==='Add by ISBN'&&!b.dataset.addBookV24).forEach(old=>{
   const b=old.cloneNode(true);b.textContent='Add book';b.dataset.addBookV24='1';old.replaceWith(b);b.addEventListener('click',openAddBook);
  });
 }
 document.querySelectorAll('[data-sidebar-add]').forEach(old=>{
  if(old.dataset.addBookV24)return;const b=old.cloneNode(true);b.textContent='Add book';b.dataset.addBookV24='1';old.replaceWith(b);b.addEventListener('click',()=>{document.querySelector('.sidebar-backdrop')?.remove();openAddBook();});
 });
}

function openAddBook(){
 modal(`<h2>Add book</h2><p>Search by title for a quick catalogue match, or use ISBN when you want a specific edition. Metadata, cover and page details are looked up immediately and stored in Supabase.</p>
 <form id="v24-add-book" class="form-stack">
  <div class="add-mode-switch" role="tablist" aria-label="Lookup method"><button type="button" class="active" data-add-mode="title">Title</button><button type="button" data-add-mode="isbn">ISBN</button></div>
  <div data-add-fields="title">
   <div class="field"><label for="v24-title">Book title</label><input class="input" id="v24-title" autocomplete="off" placeholder="e.g. Salt: A World History"></div>
   <div class="field"><label for="v24-author">Author <span class="field-optional">optional, but useful for common titles</span></label><input class="input" id="v24-author" autocomplete="off" placeholder="e.g. Mark Kurlansky"></div>
  </div>
  <div data-add-fields="isbn" hidden>
   <div class="field"><label for="v24-isbn">ISBN-10 or ISBN-13</label><input class="input" id="v24-isbn" autocomplete="off" inputmode="numeric"></div>
  </div>
  <div class="field"><label for="v24-add-state">Add as</label><select class="input" id="v24-add-state"><option value="wishlist">Wishlist</option><option value="owned">Owned · unread</option></select></div>
  <div class="modal-actions"><button class="btn" type="button" data-v24-close>Cancel</button><button class="btn btn-primary" type="submit">Search & add</button></div>
 </form>`);
 let mode='title';
 const form=modalRoot.querySelector('#v24-add-book');
 modalRoot.querySelectorAll('[data-add-mode]').forEach(b=>b.addEventListener('click',()=>{
  mode=b.dataset.addMode;modalRoot.querySelectorAll('[data-add-mode]').forEach(x=>x.classList.toggle('active',x===b));
  modalRoot.querySelectorAll('[data-add-fields]').forEach(x=>x.hidden=x.dataset.addFields!==mode);
 }));
 form?.addEventListener('submit',async e=>{
  e.preventDefault();const submit=e.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;submit.textContent='Searching…';
  try{
   const owned=e.currentTarget['v24-add-state'].value==='owned';let result;
   if(mode==='isbn'){
    const isbn=e.currentTarget['v24-isbn'].value.trim();if(!isbn)throw new Error('Enter an ISBN.');
    result=await fn('book-metadata',{isbn,owned,set_preferred:owned,overall_status:owned?'Owned - Unread':'Wishlist'});
   }else{
    const title=e.currentTarget['v24-title'].value.trim();const author=e.currentTarget['v24-author'].value.trim()||null;if(!title)throw new Error('Enter a book title.');
    result=await fn('book-metadata',{title,author,owned:false,set_preferred:false,overall_status:owned?'Owned - Unread':'Wishlist'});
    if(owned&&result?.book_id){const {error}=await supabase.rpc('set_library_status',{p_book_id:result.book_id,p_status:'Owned - Unread',p_ownership:'Owned',p_priority:null,p_source:'frontend-title-add'});if(error)throw error;}
   }
   await clearCaches();closeModal();toast('Book added with catalogue data.');window.dispatchEvent(new CustomEvent('library-data-updated'));setTimeout(()=>location.reload(),180);
  }catch(err){toast(err.message||'Could not add book',true);submit.disabled=false;submit.textContent='Search & add';}
 });
}

async function robustRefresh(bookId,button){
 if(!bookId)return;button.disabled=true;button.textContent='Refreshing…';
 try{
  let result=await fn('content-enrichment',{book_id:bookId,force:true});
  if(result?.ok===false||result?.status==='failed'||result?.status==='ambiguous'){
   await clearCaches();
   const {data:book,error}=await supabase.from('v_library').select('id,title,authors').eq('id',bookId).single();if(error)throw error;
   result=await fn('book-metadata',{book_id:bookId,title:book.title,author:String(book.authors||'').split(',')[0].trim()||null,owned:false,set_preferred:false});
   await fn('content-enrichment',{book_id:bookId,force:true}).catch(()=>null);
  }
  await clearCaches();toast('Book data refreshed.');setTimeout(()=>location.reload(),160);
 }catch(err){toast(err.message||'Could not refresh book data',true);button.disabled=false;button.textContent='Refresh book data';}
}

async function syncFreshProgress(){
 const detail=app?.querySelector('.detail-header[data-book-id][data-library-detail="ready"]');if(!detail||detail.dataset.progressV24)return;
 const block=detail.querySelector('.progress-block');if(!block){detail.dataset.progressV24='none';return;}
 detail.dataset.progressV24='loading';
 try{
  await window.LibraryDataCache?.clear?.();
  const {data,error}=await supabase.from('v_library').select('current_page,total_pages,progress_percent').eq('id',detail.dataset.bookId).single();if(error||!data)return;
  const spans=block.querySelectorAll('.progress-meta span');if(spans[0])spans[0].textContent=data.total_pages?`Page ${data.current_page??0} of ${data.total_pages}`:`Page ${data.current_page??0}`;
  const pct=Number(data.progress_percent);if(spans[1])spans[1].textContent=Number.isFinite(pct)?`${Math.round(pct)}%`:'';
  const fill=block.querySelector('.progress-fill');if(fill&&Number.isFinite(pct))fill.style.setProperty('--progress',`${Math.max(0,Math.min(100,pct))}%`);
  detail.dataset.progressV24='1';
 }finally{if(detail.dataset.progressV24==='loading')detail.dataset.progressV24='retry';}
}

function applyAll(){patchHeader();patchAdminStatus();patchAddButtons();syncFreshProgress();}
if(app)new MutationObserver(()=>{if(observerQueued)return;observerQueued=true;requestAnimationFrame(()=>{observerQueued=false;applyAll();});}).observe(app,{childList:true,subtree:true,attributes:true});
new MutationObserver(()=>patchAddButtons()).observe(document.body,{childList:true,subtree:true});
window.addEventListener('load',()=>setTimeout(applyAll,350));

// Fix Wishlist filter buttons by moving to the general Library view before applying the requested filter.
document.addEventListener('click',e=>{
 const filter=e.target.closest('.filter[data-filter]');if(!filter||reroutingFilter)return;
 const wishlistActive=app?.querySelector('.nav-btn.active[data-nav="wishlist"]');if(!wishlistActive)return;
 const wanted=filter.dataset.filter;e.preventDefault();e.stopImmediatePropagation();
 const library=app.querySelector('.nav-btn[data-nav="library"]');if(!library)return;
 reroutingFilter=true;library.click();reroutingFilter=false;
 requestAnimationFrame(()=>{app.querySelector(`.filter[data-filter="${CSS.escape(wanted)}"]`)?.click();scrollTopNow();});
},{capture:true});

// Ensure all SPA destinations open at the top instead of inheriting the previous scroll position.
document.addEventListener('click',e=>{
 const book=e.target.closest('[data-book-id]');
 if(book&&!e.target.closest('[data-progress],[data-start],[data-finish],[data-pause],[data-dnf]'))scrollTopNow();
 if(e.target.closest('[data-nav]'))scrollTopNow();
 if(e.target.closest('#recommended-see-more'))setTimeout(()=>{const layer=document.querySelector('#recommended-page-layer');if(layer)layer.scrollTop=0;},30);
});

// Override the old refresh handler so failed metadata matches get a second, title-based resolver pass.
document.addEventListener('click',e=>{
 const btn=e.target.closest('[data-v4-refresh-data]');if(!btn)return;e.preventDefault();e.stopImmediatePropagation();robustRefresh(btn.dataset.v4RefreshData,btn);
},{capture:true});

applyAll();
