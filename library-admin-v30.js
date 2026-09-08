import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const app=document.querySelector('#app');
const modalRoot=document.querySelector('#modal-root');
const toastNode=document.querySelector('#toast');
let addBusy=false;
let injectQueued=false;

const esc=(v='')=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
function toast(message,error=false){if(!toastNode)return;toastNode.textContent=message;toastNode.className=`toast show${error?' error':''}`;clearTimeout(toastNode._admin30);toastNode._admin30=setTimeout(()=>toastNode.className='toast',4200);}
function closeModal(){if(modalRoot)modalRoot.innerHTML='';}
async function fn(name,body){const {data,error}=await supabase.functions.invoke(name,{body});if(error)throw error;if(data?.error)throw new Error(data.error);return data;}
async function clearCaches(){try{localStorage.removeItem('library-detail-cache-v4');localStorage.removeItem('library-enrichment-v4');}catch{}await window.LibraryDataCache?.clear?.();}
function rememberEnrichment(bookId){try{const raw=JSON.parse(sessionStorage.getItem('reading-room-pending-enrichment')||'{}');raw[bookId]=Date.now();sessionStorage.setItem('reading-room-pending-enrichment',JSON.stringify(raw));}catch{}}

function showAddModal(html){
 modalRoot.innerHTML=`<div class="modal-backdrop library-add-v30-backdrop"><div class="modal library-add-v30-modal">${html}</div></div>`;
 modalRoot.querySelectorAll('[data-add30-close]').forEach(b=>b.addEventListener('click',closeModal));
 modalRoot.querySelector('.library-add-v30-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('library-add-v30-backdrop'))closeModal();});
}

function openAddBook(){
 addBusy=false;
 showAddModal(`<div class="add30-head"><h2>Add book</h2><p>Search, choose the exact result, then Reading Room saves its cover and core details immediately. The full metadata and edition catalogue continue loading in the background.</p></div>
 <form id="add30-search-form" class="form-stack">
  <div class="add-mode-switch" role="tablist" aria-label="Lookup method"><button type="button" class="active" data-add30-mode="title">Title</button><button type="button" data-add30-mode="isbn">ISBN</button></div>
  <div data-add30-fields="title">
   <div class="field"><label for="add30-title">Book title</label><input class="input" id="add30-title" autocomplete="off" placeholder="e.g. Becoming Martian" required></div>
   <div class="field"><label for="add30-author">Author <span class="field-optional">optional</span></label><input class="input" id="add30-author" autocomplete="off" placeholder="e.g. Scott Solomon"></div>
  </div>
  <div data-add30-fields="isbn" hidden>
   <div class="field"><label for="add30-isbn">ISBN-10 or ISBN-13</label><input class="input" id="add30-isbn" autocomplete="off" inputmode="numeric"></div>
  </div>
  <div class="field"><label for="add30-state">Add as</label><select class="input" id="add30-state"><option value="wishlist">Wishlist</option><option value="owned">Owned · unread</option></select></div>
  <div class="modal-actions"><button class="btn" type="button" data-add30-close>Cancel</button><button class="btn btn-primary" type="submit">Search</button></div>
 </form>`);
 let mode='title';
 const form=modalRoot.querySelector('#add30-search-form');
 modalRoot.querySelectorAll('[data-add30-mode]').forEach(b=>b.addEventListener('click',()=>{
  mode=b.dataset.add30Mode;
  modalRoot.querySelectorAll('[data-add30-mode]').forEach(x=>x.classList.toggle('active',x===b));
  modalRoot.querySelectorAll('[data-add30-fields]').forEach(x=>x.hidden=x.dataset.add30Fields!==mode);
  const title=modalRoot.querySelector('#add30-title');if(title)title.required=mode==='title';
 }));
 form?.addEventListener('submit',async e=>{
  e.preventDefault();const submit=e.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;submit.textContent='Searching…';
  try{
   const query=mode==='isbn'?e.currentTarget['add30-isbn'].value.trim():e.currentTarget['add30-title'].value.trim();
   const author=mode==='title'?e.currentTarget['add30-author'].value.trim():'';
   if(!query)throw new Error(mode==='isbn'?'Enter an ISBN.':'Enter a book title.');
   const addAs=e.currentTarget['add30-state'].value;
   const result=await fn('book-search',{query,author:author||null});
   renderResults({query,author,mode,addAs,results:result.results||[]});
  }catch(err){toast(err.message||'Could not search for books',true);submit.disabled=false;submit.textContent='Search';}
 });
}

function resultMeta(r){return [r.publication_year,r.publisher,r.page_count?`${r.page_count} pages`:null,r.isbn13||r.isbn10].filter(Boolean).join(' · ');}
function renderResults(ctx){
 const results=ctx.results||[];
 showAddModal(`<div class="add30-head"><p class="admin-kicker">Search results</p><h2>Choose the correct book</h2><p>${results.length?`${results.length} possible ${results.length===1?'match':'matches'} for “${esc(ctx.query)}”. Tap one to add it as ${ctx.addAs==='owned'?'Owned · unread':'Wishlist'}.`:`No reliable matches for “${esc(ctx.query)}”.`}</p></div>
 ${results.length?`<div class="add30-results">${results.map((r,i)=>`<button type="button" class="add30-result ${r.already_in_library?'is-existing':''}" data-add30-result="${i}" ${r.already_in_library?'disabled':''}>
   <div class="add30-cover">${r.cover_url?`<img src="${esc(r.cover_url)}" alt="" loading="eager" onerror="this.remove()">`:'<span>No cover</span>'}</div>
   <div class="add30-result-copy"><div class="add30-result-title">${esc(r.title)}</div>${r.subtitle?`<div class="add30-result-subtitle">${esc(r.subtitle)}</div>`:''}<div class="add30-result-author">${esc((r.authors||[]).join(', ')||'Unknown author')}</div><div class="add30-result-meta">${esc(resultMeta(r))}</div><div class="add30-result-source">${r.already_in_library?'Already in your library':esc(r.provider||'Catalogue result')}</div></div>
  </button>`).join('')}</div>`:'<div class="add30-empty">Try the title with the author, or use an ISBN if you have one.</div>'}
 <div class="modal-actions add30-result-actions"><button class="btn" type="button" data-add30-close>Cancel</button><button class="btn" type="button" id="add30-search-again">Search again</button></div>`);
 modalRoot.querySelector('#add30-search-again')?.addEventListener('click',openAddBook);
 modalRoot.querySelectorAll('[data-add30-result]').forEach(b=>b.addEventListener('click',()=>addSelected(ctx,results[Number(b.dataset.add30Result)],b)));
}

async function addSelected(ctx,result,button){
 if(addBusy||!result||result.already_in_library)return;addBusy=true;
 modalRoot.querySelectorAll('[data-add30-result]').forEach(b=>b.disabled=true);button.classList.add('is-adding');
 const status=ctx.addAs==='owned'?'Owned - Unread':'Wishlist',ownership=ctx.addAs==='owned'?'Owned':'Not Owned';
 try{
  if(!result.isbn13&&!result.isbn10)throw new Error('That result has no usable ISBN. Choose another edition.');
  const {data,error}=await supabase.rpc('library_add_selected_result',{p_result:result,p_status:status,p_ownership:ownership});if(error)throw error;
  if(data?.already_in_library)throw new Error('That exact edition is already in your library.');
  const bookId=data?.book_id;
  if(bookId){rememberEnrichment(bookId);await fn('book-background-enrich',{book_id:bookId}).catch(err=>console.info('[Reading Room] background enrichment will retry later',err?.message||err));}
  await clearCaches();closeModal();
  toast(`${result.title} added. Finishing metadata and editions in the background.`);
  window.dispatchEvent(new CustomEvent('library-data-updated',{detail:{bookId,background:true}}));
  setTimeout(()=>location.reload(),220);
 }catch(err){toast(err.message||'Could not add that book',true);addBusy=false;modalRoot.querySelectorAll('[data-add30-result]').forEach(b=>{if(!b.classList.contains('is-existing'))b.disabled=false;});button.classList.remove('is-adding');}
}

function currentBookId(){return app?.querySelector('.detail-header[data-book-id]')?.dataset.bookId||null;}
function injectDelete(){
 const modal=modalRoot?.querySelector('.book-admin-modal');if(!modal||modal.querySelector('[data-delete-book-v30]'))return;
 const form=modal.querySelector('#book-admin-form'),actions=form?.querySelector('.book-admin-actions'),bookId=currentBookId();if(!form||!actions||!bookId)return;
 const title=app?.querySelector('.detail-copy h1')?.textContent?.trim()||'this book';
 const section=document.createElement('section');section.className='delete-book-v30';section.innerHTML=`<div><p class="admin-kicker">Danger zone</p><h3>Delete book</h3><p>Permanently remove this book and its editions, progress, feedback, ratings and recommendation history.</p></div><button class="btn btn-danger" type="button" data-delete-book-v30>Delete book</button><div class="delete-confirm-v30" hidden><p><strong>Delete “${esc(title)}”?</strong> This cannot be undone.</p><div><button class="btn" type="button" data-delete-cancel-v30>Cancel</button><button class="btn btn-danger" type="button" data-delete-confirm-v30>Delete permanently</button></div></div>`;
 actions.before(section);const confirm=section.querySelector('.delete-confirm-v30');
 section.querySelector('[data-delete-book-v30]')?.addEventListener('click',()=>{confirm.hidden=false;section.querySelector('[data-delete-book-v30]').hidden=true;});
 section.querySelector('[data-delete-cancel-v30]')?.addEventListener('click',()=>{confirm.hidden=true;section.querySelector('[data-delete-book-v30]').hidden=false;});
 section.querySelector('[data-delete-confirm-v30]')?.addEventListener('click',async e=>{const btn=e.currentTarget;btn.disabled=true;btn.textContent='Deleting…';try{const {error}=await supabase.rpc('delete_library_book',{p_book_id:bookId});if(error)throw error;await clearCaches();closeModal();toast(`${title} deleted.`);setTimeout(()=>location.reload(),180);}catch(err){toast(err.message||'Could not delete book',true);btn.disabled=false;btn.textContent='Delete permanently';}});
}

document.addEventListener('click',e=>{const target=e.target.closest('[data-add-book-v24],[data-sidebar-add]');if(!target)return;e.preventDefault();e.stopImmediatePropagation();document.querySelector('.sidebar-backdrop')?.remove();openAddBook();},{capture:true});
if(modalRoot)new MutationObserver(()=>{if(injectQueued)return;injectQueued=true;requestAnimationFrame(()=>{injectQueued=false;injectDelete();});}).observe(modalRoot,{childList:true,subtree:true});
