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
function fallbackCover(book){const [a,b]=palette(book.title);return `<div class="upnext-cover" style="--a:${a};--b:${b}">${book.cover_url?`<img src="${esc(book.cover_url)}" alt="Cover of ${esc(book.title)}" loading="lazy" onerror="this.remove()">`:''}<div class="upnext-cover-fallback"><small>${esc(book.primary_genre||'Library')}</small><strong>${esc(book.title)}</strong></div></div>`;}

async function loadQueue(){
 if(loading)return;loading=true;
 try{
  const {data:{session}}=await supabase.auth.getSession();if(!session)return;
  const [q,l]=await Promise.all([
   supabase.from('v_up_next').select('*').order('position'),
   supabase.from('v_library').select('id,title,authors,overall_status,ownership_status,cover_url,primary_genre').order('title')
  ]);
  if(q.error)throw q.error;if(l.error)throw l.error;
  queue=q.data||[];library=l.data||[];renderShelf();
 }catch(e){console.info('[Library] Up Next unavailable',e?.message||e);}
 finally{loading=false;}
}

function sourceLabel(item){if(item.source==='Manual')return item.locked?'Planned by you · locked':'Planned by you';return item.locked?'Librarian pick · locked':'Librarian pick';}
function queueCard(item){return `<article class="upnext-card" data-upnext-book="${item.id}">${fallbackCover(item)}<div class="upnext-copy"><div class="upnext-position">${item.position}</div><div class="upnext-card-main"><p class="upnext-source ${item.source==='Manual'?'manual':'ai'}">${esc(sourceLabel(item))}</p><h3>${esc(item.title)}</h3><p class="upnext-author">${esc(item.authors||'Unknown author')}</p>${item.ai_score!=null?`<p class="upnext-score">${Number(item.ai_score).toFixed(1)}/10 · ${esc(item.confidence||'')} confidence</p>`:''}<p class="upnext-reason">${esc(item.reason||item.why_recommended||'Queued for later.')}</p></div></div></article>`;}

function findOwnedSection(){return [...document.querySelectorAll('main .section')].find(s=>s.querySelector('h2')?.textContent?.trim().toLowerCase()==='owned & unread')||null;}
function renderShelf(){
 const owned=findOwnedSection();if(!owned)return;
 let section=document.querySelector('#up-next-section');
 if(!section){section=document.createElement('section');section.id='up-next-section';section.className='section up-next-section';owned.parentNode.insertBefore(section,owned);}
 section.innerHTML=`<div class="section-header"><div><h2>Up Next</h2><p class="upnext-subtitle">A mix of your locked plans and librarian-managed picks.</p></div><button class="upnext-manage" id="manage-up-next" type="button">Manage</button></div>${queue.length?`<div class="upnext-row">${queue.map(queueCard).join('')}</div>`:'<div class="empty-shelf">Nothing queued yet.</div>'}`;
 section.querySelector('#manage-up-next')?.addEventListener('click',openManager);
 section.querySelectorAll('[data-upnext-book]').forEach(card=>card.addEventListener('click',()=>openBook(card.dataset.upnextBook)));
}

function openBook(id){
 const candidates=[...document.querySelectorAll(`[data-book-id="${CSS.escape(id)}"]`)].filter(n=>!n.closest('#up-next-section'));
 if(candidates[0]){candidates[0].click();return;}
 const libBtn=document.querySelector('[data-nav="library"]');if(libBtn){libBtn.click();setTimeout(()=>{const card=[...document.querySelectorAll(`[data-book-id="${CSS.escape(id)}"]`)].find(n=>!n.closest('#up-next-section'));card?.click();},120);}
}

function modal(html){modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal upnext-modal">${html}</div></div>`;modalRoot.querySelectorAll('[data-upnext-close]').forEach(b=>b.addEventListener('click',()=>modalRoot.innerHTML=''));modalRoot.querySelector('.modal-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))modalRoot.innerHTML='';});}
function remainingBooks(){const ids=new Set(queue.map(x=>x.id));return library.filter(b=>!ids.has(b.id)&&!['Currently Reading','Read','DNF','Not Interested'].includes(b.overall_status));}
function managerRow(item,index){return `<div class="queue-manager-row" data-queue-id="${item.queue_id}"><div class="queue-manager-order">${index+1}</div><div class="queue-manager-copy"><strong>${esc(item.title)}</strong><span>${esc(item.authors||'')}</span><small>${item.source==='Manual'?'Manual':'AI'}${item.locked?' · locked':''}</small></div><div class="queue-manager-actions"><button type="button" data-move="up" ${index===0?'disabled':''} aria-label="Move up">↑</button><button type="button" data-move="down" ${index===queue.length-1?'disabled':''} aria-label="Move down">↓</button><button type="button" data-lock="${item.locked?'0':'1'}">${item.locked?'Unlock':'Lock'}</button><button type="button" data-remove>Remove</button></div></div>`;}
function openManager(){
 const remaining=remainingBooks();
 modal(`<div class="upnext-manager-head"><div><p class="eyebrow">Reading queue</p><h2>Manage Up Next</h2></div><button class="btn" type="button" data-upnext-close>Done</button></div><p class="upnext-manager-note">Locked items are protected from future librarian reshuffles. Manual additions are locked by default.</p><div id="queue-manager-list">${queue.map(managerRow).join('')}</div><form id="upnext-add-form" class="upnext-add-form"><label for="upnext-add-book">Add a book manually</label><select id="upnext-add-book" class="input" ${remaining.length?'':'disabled'}><option value="">${remaining.length?'Choose a book…':'No eligible books available'}</option>${remaining.map(b=>`<option value="${b.id}">${esc(b.title)} — ${esc(b.authors||'')}</option>`).join('')}</select><button class="btn btn-primary" type="submit" ${remaining.length?'':'disabled'}>Add to queue</button></form>`);
 bindManager();
}
function bindManager(){
 modalRoot.querySelectorAll('.queue-manager-row').forEach((row,index)=>{
  row.querySelector('[data-move="up"]')?.addEventListener('click',()=>move(index,-1));
  row.querySelector('[data-move="down"]')?.addEventListener('click',()=>move(index,1));
  row.querySelector('[data-lock]')?.addEventListener('click',async e=>{const locked=e.currentTarget.dataset.lock==='1';await mutate('up_next_set_locked',{p_queue_id:row.dataset.queueId,p_locked:locked});});
  row.querySelector('[data-remove]')?.addEventListener('click',async()=>{await mutate('up_next_remove',{p_queue_id:row.dataset.queueId});});
 });
 modalRoot.querySelector('#upnext-add-form')?.addEventListener('submit',async e=>{e.preventDefault();const id=e.currentTarget['upnext-add-book'].value;if(!id)return;await mutate('up_next_add',{p_book_id:id,p_source:'Manual',p_reason:'Added manually from Library.',p_locked:true,p_ai_score:null,p_confidence:null});});
}
async function move(index,delta){const next=index+delta;if(next<0||next>=queue.length)return;const reordered=[...queue];[reordered[index],reordered[next]]=[reordered[next],reordered[index]];const {error}=await supabase.rpc('up_next_reorder',{p_queue_ids:reordered.map(x=>x.queue_id)});if(error){toast(error.message,true);return;}await window.LibraryDataCache?.clear?.();await loadQueue();openManager();}
async function mutate(name,args){
 try{const {error}=await supabase.rpc(name,args);if(error)throw error;await window.LibraryDataCache?.clear?.();await loadQueue();openManager();}
 catch(e){toast(e.message||'Could not update queue',true);}
}

function scheduleRender(){if(observerPending)return;observerPending=true;requestAnimationFrame(()=>{observerPending=false;renderShelf();});}
if(app)new MutationObserver(scheduleRender).observe(app,{childList:true,subtree:true});
window.addEventListener('load',()=>setTimeout(loadQueue,500));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(loadQueue,300);});
window.addEventListener('online',()=>setTimeout(loadQueue,300));
supabase.auth.onAuthStateChange((_e,s)=>{if(s)setTimeout(loadQueue,350);else{queue=[];library=[];document.querySelector('#up-next-section')?.remove();}});
window.addEventListener('library-data-updated',()=>setTimeout(loadQueue,150));
