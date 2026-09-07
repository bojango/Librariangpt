import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const app=document.querySelector('#app');
const modalRoot=document.querySelector('#modal-root');
const toastNode=document.querySelector('#toast');
let queue=[];
let library=[];
let loading=false;
let observerPending=false;

const esc=(v='')=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
function toast(message,error=false){if(!toastNode)return;toastNode.textContent=message;toastNode.className=`toast show${error?' error':''}`;clearTimeout(toastNode._upnext);toastNode._upnext=setTimeout(()=>toastNode.className='toast',3200);}
function palette(title=''){let h=2166136261;for(const ch of title)h=Math.imul(h^ch.charCodeAt(0),16777619);const p=[['#a6957e','#3c332d'],['#748d82','#293832'],['#94849a','#332d37'],['#9b8586','#3a2e30'],['#84916f','#2d3526'],['#788fa5','#27333d']];return p[Math.abs(h)%p.length];}
function coverMarkup(book,className='upnext-cover'){const[a,b]=palette(book.title);return `<div class="${className}" style="--a:${a};--b:${b}">${book.cover_url?`<img src="${esc(book.cover_url)}" alt="Cover of ${esc(book.title)}" loading="lazy" onerror="this.remove()">`:''}<div class="upnext-cover-fallback"><small>${esc(book.primary_genre||'Library')}</small><strong>${esc(book.title)}</strong></div></div>`;}

async function loadQueue(){
 if(loading)return;loading=true;
 try{
  const {data:{session}}=await supabase.auth.getSession();if(!session)return;
  const [q,l]=await Promise.all([
   supabase.from('v_up_next').select('*').order('position'),
   supabase.from('v_library').select('id,title,authors,overall_status,ownership_status,cover_url,primary_genre,current_edition_id,display_edition_id,total_pages').order('title')
  ]);
  if(q.error)throw q.error;if(l.error)throw l.error;
  queue=q.data||[];library=l.data||[];renderShelf();
 }catch(e){console.info('[Library] Up Next unavailable',e?.message||e);}
 finally{loading=false;}
}

function sourceLabel(item){if(item.source==='Manual')return item.locked?'Your pick · locked':'Your pick';return item.locked?'Librarian pick · locked':'Librarian pick';}
function queueCard(item){return `<article class="upnext-card" data-upnext-book="${item.id}" tabindex="0" role="button" aria-label="Open Up Next details for ${esc(item.title)}">${coverMarkup(item)}<div class="upnext-copy"><div class="upnext-position">${item.position}</div><div class="upnext-card-main"><p class="upnext-source ${item.source==='Manual'?'manual':'ai'}">${esc(sourceLabel(item))}</p><h3>${esc(item.title)}</h3><p class="upnext-author">${esc(item.authors||'Unknown author')}</p>${item.ai_score!=null?`<p class="upnext-score">${Number(item.ai_score).toFixed(1)}/10 · ${esc(item.confidence||'')} confidence</p>`:''}<p class="upnext-reason">${esc(item.reason||item.why_recommended||'Queued for later.')}</p></div></div></article>`;}

function findOwnedSection(){return [...document.querySelectorAll('main .section')].find(s=>s.querySelector('h2')?.textContent?.trim().toLowerCase()==='owned & unread')||null;}
function renderShelf(){
 const owned=findOwnedSection();if(!owned)return;
 let section=document.querySelector('#up-next-section');
 if(!section){section=document.createElement('section');section.id='up-next-section';section.className='section up-next-section';owned.parentNode.insertBefore(section,owned);}
 const markup=`<div class="section-header"><h2>Up Next</h2><button class="upnext-manage" id="manage-up-next" type="button">Manage</button></div>${queue.length?`<div class="upnext-row">${queue.map(queueCard).join('')}</div>`:'<div class="empty-shelf">Nothing queued yet.</div>'}`;
 const signature=queue.map(x=>`${x.queue_id}:${x.position}:${x.locked}:${x.source}:${x.cover_url||''}:${x.reason||''}`).join('|');
 if(section.dataset.signature===signature)return;
 section.dataset.signature=signature;section.innerHTML=markup;
 section.querySelector('#manage-up-next')?.addEventListener('click',openManager);
 section.querySelectorAll('[data-upnext-book]').forEach(card=>{
  const open=()=>{const item=queue.find(x=>x.id===card.dataset.upnextBook);if(item)openDetails(item);};
  card.addEventListener('click',open);
  card.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open();}});
 });
}

function modal(html,extraClass=''){modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal ${extraClass}">${html}</div></div>`;modalRoot.querySelectorAll('[data-upnext-close]').forEach(b=>b.addEventListener('click',()=>modalRoot.innerHTML=''));modalRoot.querySelector('.modal-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))modalRoot.innerHTML='';});}

function openDetails(item){
 const fullReason=item.reason||item.why_recommended||'This book is in the queue because it is a strong fit for what you appear to want next.';
 modal(`<div class="upnext-detail-shell"><button class="upnext-detail-close" type="button" data-upnext-close aria-label="Close">×</button><div class="upnext-detail-grid">${coverMarkup(item,'upnext-detail-cover')}<div class="upnext-detail-body"><p class="upnext-source ${item.source==='Manual'?'manual':'ai'}">${esc(sourceLabel(item))}</p><h2>${esc(item.title)}</h2><p class="upnext-detail-author">${esc(item.authors||'Unknown author')}</p>${item.ai_score!=null?`<p class="upnext-detail-score">${Number(item.ai_score).toFixed(1)}/10 · ${esc(item.confidence||'')} confidence</p>`:''}<div class="upnext-detail-reason"><h3>Why it’s up next</h3><p>${esc(fullReason)}</p></div><div class="upnext-detail-actions"><button class="btn btn-primary" id="upnext-read-now" type="button">Read now</button><button class="btn" id="upnext-open-book" type="button">Open book</button></div></div></div></div>`,'upnext-detail-modal');
 modalRoot.querySelector('#upnext-read-now')?.addEventListener('click',e=>readNow(item,e.currentTarget));
 modalRoot.querySelector('#upnext-open-book')?.addEventListener('click',()=>{modalRoot.innerHTML='';openBook(item.id);});
}

async function readNow(item,button){
 button.disabled=true;button.textContent='Starting…';
 try{
  const book=library.find(b=>b.id===item.id)||item;
  const editionId=book.current_edition_id||book.display_edition_id||null;
  const total=book.total_pages?Number(book.total_pages):null;
  const {error}=await supabase.rpc('start_reading',{p_book_id:item.id,p_edition_id:editionId,p_total_pages:total});
  if(error)throw error;
  await window.LibraryDataCache?.clear?.();
  modalRoot.innerHTML='';toast(`${item.title} is now your current read.`);
  document.querySelector('#refresh')?.click();
  setTimeout(()=>{loading=false;loadQueue();},350);
 }catch(e){toast(e.message||'Could not start this book',true);button.disabled=false;button.textContent='Read now';}
}

function openBook(id){
 const candidates=[...document.querySelectorAll(`[data-book-id="${CSS.escape(id)}"]`)].filter(n=>!n.closest('#up-next-section'));
 if(candidates[0]){candidates[0].click();return;}
 const libBtn=document.querySelector('[data-nav="library"]');if(libBtn){libBtn.click();setTimeout(()=>{const card=[...document.querySelectorAll(`[data-book-id="${CSS.escape(id)}"]`)].find(n=>!n.closest('#up-next-section'));card?.click();},120);}
}

function remainingBooks(){const ids=new Set(queue.map(x=>x.id));return library.filter(b=>!ids.has(b.id)&&!['Currently Reading','Read','DNF','Not Interested'].includes(b.overall_status));}
function managerRow(item,index){return `<div class="queue-manager-row" data-queue-id="${item.queue_id}"><div class="queue-manager-order">${index+1}</div><div class="queue-manager-copy"><strong>${esc(item.title)}</strong><span>${esc(item.authors||'')}</span><small>${item.source==='Manual'?'Your pick':'Librarian pick'}${item.locked?' · locked':''}</small></div><div class="queue-manager-actions"><button type="button" data-move="up" ${index===0?'disabled':''} aria-label="Move up">↑</button><button type="button" data-move="down" ${index===queue.length-1?'disabled':''} aria-label="Move down">↓</button><button type="button" data-lock="${item.locked?'0':'1'}">${item.locked?'Unlock':'Lock'}</button><button type="button" data-remove>Remove</button></div></div>`;}
function openManager(){
 const remaining=remainingBooks();
 modal(`<div class="upnext-manager-head"><div><p class="eyebrow">Reading queue</p><h2>Manage Up Next</h2></div><button class="btn" type="button" data-upnext-close>Done</button></div><p class="upnext-manager-note">Locked items are protected from future librarian reshuffles. Manual additions are locked by default.</p><div id="queue-manager-list">${queue.map(managerRow).join('')}</div><form id="upnext-add-form" class="upnext-add-form"><label for="upnext-add-book">Add a book manually</label><select id="upnext-add-book" class="input" ${remaining.length?'':'disabled'}><option value="">${remaining.length?'Choose a book…':'No eligible books available'}</option>${remaining.map(b=>`<option value="${b.id}">${esc(b.title)} — ${esc(b.authors||'')}</option>`).join('')}</select><button class="btn btn-primary" type="submit" ${remaining.length?'':'disabled'}>Add to queue</button></form>`,'upnext-modal');
 bindManager();
}
function bindManager(){
 modalRoot.querySelectorAll('.queue-manager-row').forEach((row,index)=>{
  row.querySelector('[data-move="up"]')?.addEventListener('click',()=>move(index,-1));
  row.querySelector('[data-move="down"]')?.addEventListener('click',()=>move(index,1));
  row.querySelector('[data-lock]')?.addEventListener('click',async e=>{const locked=e.currentTarget.dataset.lock==='1';await mutate('up_next_set_locked',{p_queue_id:row.dataset.queueId,p_locked:locked});});
  row.querySelector('[data-remove]')?.addEventListener('click',async()=>{await mutate('up_next_remove',{p_queue_id:row.dataset.queueId});});
 });
 modalRoot.querySelector('#upnext-add-form')?.addEventListener('submit',async e=>{e.preventDefault();const id=e.currentTarget['upnext-add-book'].value;if(!id)return;await mutate('up_next_add',{p_book_id:id,p_source:'Manual',p_reason:'Added manually from Library. This is your pick, so it is locked against automatic librarian reshuffling until you choose to unlock it.',p_locked:true,p_ai_score:null,p_confidence:null});});
}
async function move(index,delta){const next=index+delta;if(next<0||next>=queue.length)return;const reordered=[...queue];[reordered[index],reordered[next]]=[reordered[next],reordered[index]];const {error}=await supabase.rpc('up_next_reorder',{p_queue_ids:reordered.map(x=>x.queue_id)});if(error){toast(error.message,true);return;}await window.LibraryDataCache?.clear?.();loading=false;await loadQueue();openManager();}
async function mutate(name,args){
 try{const {error}=await supabase.rpc(name,args);if(error)throw error;await window.LibraryDataCache?.clear?.();loading=false;await loadQueue();openManager();}
 catch(e){toast(e.message||'Could not update queue',true);}
}

function scheduleRender(){if(observerPending)return;observerPending=true;requestAnimationFrame(()=>{observerPending=false;renderShelf();});}
if(app)new MutationObserver(scheduleRender).observe(app,{childList:true,subtree:true});
window.addEventListener('load',()=>setTimeout(loadQueue,500));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>{loading=false;loadQueue();},300);});
window.addEventListener('online',()=>setTimeout(()=>{loading=false;loadQueue();},300));
supabase.auth.onAuthStateChange((_e,s)=>{if(s)setTimeout(()=>{loading=false;loadQueue();},350);else{queue=[];library=[];document.querySelector('#up-next-section')?.remove();}});
window.addEventListener('library-data-updated',()=>setTimeout(()=>{loading=false;loadQueue();},150));
