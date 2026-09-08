import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const app=document.querySelector('#app');
const modalRoot=document.querySelector('#modal-root');
const toastNode=document.querySelector('#toast');
let injectQueued=false;
let activeFilter='All';

const esc=(v='')=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const fmtDate=v=>{if(!v)return null;try{return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(v));}catch{return String(v)}};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function toast(message,error=false){if(!toastNode)return;toastNode.textContent=message;toastNode.className=`toast show${error?' error':''}`;clearTimeout(toastNode._editions);toastNode._editions=setTimeout(()=>toastNode.className='toast',3600);}
function cover(book,e){const src=e?.cover_url||book?.cover_url||'';return `<div class="edition-cover">${src?`<img src="${esc(src)}" alt="Cover of ${esc(book.title)}" loading="lazy" onerror="this.remove()">`:''}<div class="edition-cover-fallback"><strong>${esc(book.title)}</strong></div></div>`;}
function formatGroup(format=''){const f=String(format).toLowerCase();if(/hard/.test(f))return 'Hardcover';if(/paper|soft/.test(f))return 'Paperback';if(/kindle|ebook|e-book|electronic/.test(f))return 'eBook';if(/audio/.test(f))return 'Audiobook';return 'Other';}
function selectedId(book){return book.current_edition_id||book.reference_edition_id||book.display_edition_id||null;}
function isSelected(book,e){return e.id===selectedId(book);}
function editionHeading(e){return [e.format||e.binding||'Edition',e.publication_year].filter(Boolean).join(' · ');}
function editionFacts(e){return [e.page_count?`${e.page_count} pages`:null,e.language,e.publication_date?`Published ${fmtDate(e.publication_date)}`:e.publication_year?`Published ${e.publication_year}`:null,e.publisher?`by ${e.publisher}`:null,e.isbn13||e.isbn10?`ISBN ${e.isbn13||e.isbn10}`:null].filter(Boolean);}
function badges(book,e){const out=[];if(isSelected(book,e))out.push(book.ownership_status==='Owned'?'Current edition':'Reference edition');if(e.owned)out.push('Owned copy');if(e.preferred_copy)out.push('Preferred');return out.map(x=>`<span>${esc(x)}</span>`).join('');}
function sortEditions(book,rows){const sid=selectedId(book);return [...rows].sort((a,b)=>Number(b.id===sid)-Number(a.id===sid)||Number(Boolean(b.owned))-Number(Boolean(a.owned))||Number(Boolean(b.preferred_copy))-Number(Boolean(a.preferred_copy))||(Number(b.publication_year||0)-Number(a.publication_year||0)));}

async function fetchBundle(bookId){
 const [b,e,s]=await Promise.all([
  supabase.from('v_library').select('*').eq('id',bookId).single(),
  supabase.from('editions').select('*').eq('book_id',bookId),
  supabase.from('books').select('editions_status,editions_last_refreshed_at,editions_error').eq('id',bookId).single()
 ]);
 if(b.error)throw b.error;if(e.error)throw e.error;
 return {book:b.data,editions:sortEditions(b.data,e.data||[]),state:s.data||{}};
}

function actionButtons(bundle,e){const {book}=bundle;if(isSelected(book,e))return `<span class="edition-current-label">${book.ownership_status==='Owned'?'Current edition':'Current reference'}</span>`;
 const reading=['Currently Reading','Paused'].includes(book.overall_status);
 if(reading)return `<button class="btn btn-primary" type="button" data-edition-use="${e.id}">Switch reading edition</button>`;
 if(book.ownership_status==='Owned')return `<button class="btn btn-primary" type="button" data-edition-own="${e.id}">Use as my edition</button>`;
 return `<button class="btn btn-primary" type="button" data-edition-use="${e.id}">Use as reference</button><button class="btn edition-own-secondary" type="button" data-edition-own="${e.id}">Mark as owned copy</button>`;
}
function editionCard(bundle,e){const {book}=bundle;return `<article class="edition-row ${isSelected(book,e)?'selected':''}" data-edition-row="${e.id}">${cover(book,e)}<div class="edition-row-copy"><div class="edition-badges">${badges(book,e)}</div><h3>${esc(editionHeading(e))}</h3>${e.edition_statement?`<p class="edition-statement">${esc(e.edition_statement)}</p>`:''}<div class="edition-facts">${editionFacts(e).map(x=>`<span>${esc(x)}</span>`).join('')}</div><div class="edition-row-actions">${actionButtons(bundle,e)}</div></div></article>`;}
function filters(rows){const groups=['All',...new Set(rows.map(e=>formatGroup(e.format||e.binding)).filter(x=>x!=='Other'))];return groups.length>1?`<div class="edition-filters">${groups.map(g=>`<button type="button" data-edition-filter="${esc(g)}" class="${activeFilter===g?'active':''}">${esc(g)}</button>`).join('')}</div>`:'';}

function renderBrowser(bundle,{searching=false}={}){
 const {book,state}=bundle;let rows=sortEditions(book,bundle.editions);const filtered=activeFilter==='All'?rows:rows.filter(e=>formatGroup(e.format||e.binding)===activeFilter);
 modalRoot.innerHTML=`<div class="modal-backdrop edition-browser-backdrop"><section class="edition-browser-modal" role="dialog" aria-modal="true" aria-labelledby="edition-browser-title"><header class="edition-browser-head"><div><p class="eyebrow">Book editions</p><h2 id="edition-browser-title">${esc(book.title)}</h2><p>${book.ownership_status==='Owned'?'Choose the edition that matches your copy.':'Choose any sensible reference edition now. You can replace it with the exact ISBN if you buy the book later.'}</p></div><button type="button" class="edition-close" data-edition-close aria-label="Close">×</button></header>${filters(rows)}<div class="edition-browser-status">${searching?'<span class="edition-spinner"></span> Finding more editions…':`<span>${rows.length} known edition${rows.length===1?'':'s'}</span><button type="button" data-edition-refresh>${state.editions_last_refreshed_at?'Refresh editions':'Find editions'}</button>`}</div>${state.editions_error&&!searching?`<p class="edition-error">${esc(state.editions_error)}</p>`:''}<div class="edition-list">${filtered.length?filtered.map(e=>editionCard(bundle,e)).join(''):'<div class="edition-empty">No editions match this filter.</div>'}</div></section></div>`;
 bindBrowser(bundle);
}
function close(){modalRoot.innerHTML='';activeFilter='All';}
function bindBrowser(bundle){
 modalRoot.querySelector('[data-edition-close]')?.addEventListener('click',close);
 modalRoot.querySelector('.edition-browser-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('edition-browser-backdrop'))close();});
 modalRoot.querySelector('[data-edition-refresh]')?.addEventListener('click',()=>discover(bundle.book.id,true));
 modalRoot.querySelectorAll('[data-edition-filter]').forEach(b=>b.addEventListener('click',()=>{activeFilter=b.dataset.editionFilter;renderBrowser(bundle);}));
 modalRoot.querySelectorAll('[data-edition-use]').forEach(b=>b.addEventListener('click',()=>chooseEdition(bundle,b.dataset.editionUse,false)));
 modalRoot.querySelectorAll('[data-edition-own]').forEach(b=>b.addEventListener('click',()=>chooseEdition(bundle,b.dataset.editionOwn,true)));
}

async function pollRefresh(bookId,before,{attempts=15,delay=2000}={}){
 const oldCount=before.editions.length;
 const oldStamp=before.state?.editions_last_refreshed_at||null;
 for(let i=0;i<attempts;i++){
  await sleep(delay);
  const next=await fetchBundle(bookId).catch(()=>null);
  if(!next)continue;
  const newStamp=next.state?.editions_last_refreshed_at||null;
  const finished=next.state?.editions_status!=='refreshing';
  const changed=next.editions.length!==oldCount||newStamp!==oldStamp;
  if(finished&&changed)return next;
  if(finished&&next.state?.editions_status==='failed')return next;
 }
 return await fetchBundle(bookId).catch(()=>null);
}

async function discover(bookId,force=false){
 let before=null;
 try{
  before=await fetchBundle(bookId);renderBrowser(before,{searching:true});
  let data=null,invokeError=null;
  try{const result=await supabase.functions.invoke('edition-options',{body:{book_id:bookId,force}});data=result.data;invokeError=result.error;if(data?.error)invokeError=new Error(data.error);}catch(err){invokeError=err;}
  let after=await fetchBundle(bookId).catch(()=>null);
  if(after?.state?.editions_status==='refreshing'||(invokeError&&after&&after.editions.length<=before.editions.length)){
   renderBrowser(after||before,{searching:true});
   after=await pollRefresh(bookId,before);
  }
  if(after){
   const added=Math.max(0,after.editions.length-before.editions.length);
   const completed=after.state?.editions_status==='ready'||after.state?.editions_status==='partial';
   if(completed&&after.editions.length>before.editions.length){renderBrowser(after);toast(`Edition catalogue updated: ${added} added.`);return;}
   if(completed&&!invokeError){renderBrowser(after);if(data?.message)toast(data.message,after.state?.editions_status!=='ready');return;}
   if(after.state?.editions_status==='failed'){renderBrowser(after);throw new Error(after.state?.editions_error||'Edition search failed');}
  }
  if(invokeError)throw invokeError;
  if(after)renderBrowser(after);else renderBrowser(before);
 }catch(err){
  const bundle=await fetchBundle(bookId).catch(()=>null);
  if(bundle){
   if(bundle.state?.editions_status==='refreshing'){renderBrowser(bundle,{searching:true});toast('Edition search is still running in the background.');return;}
   renderBrowser(bundle);
  }
  toast(err.message||'Could not refresh editions',true);
 }
}
function progressChoice(bundle,e,markOwned){const {book}=bundle;const oldTotal=Number(book.total_pages||0),newTotal=Number(e.page_count||0),page=Number(book.current_page||0);if(!oldTotal||!newTotal||oldTotal===newTotal)return applyEdition(bundle,e,markOwned,'page');const percent=Math.round((page/oldTotal)*100);const converted=Math.min(newTotal,Math.max(0,Math.round(page/oldTotal*newTotal)));
 modalRoot.innerHTML=`<div class="modal-backdrop edition-progress-backdrop"><div class="modal edition-progress-modal"><h2>Switch reading edition?</h2><p>You are on page <strong>${page}</strong> of ${oldTotal} (${percent}%). The selected edition has ${newTotal} pages.</p><div class="edition-progress-options"><button class="btn btn-primary" type="button" data-progress-mode="percentage">Keep my place · page ${converted}</button><button class="btn" type="button" data-progress-mode="page">Keep page ${Math.min(page,newTotal)}</button><button class="btn" type="button" data-progress-cancel>Cancel</button></div></div></div>`;
 modalRoot.querySelectorAll('[data-progress-mode]').forEach(b=>b.addEventListener('click',()=>applyEdition(bundle,e,markOwned,b.dataset.progressMode)));
 modalRoot.querySelector('[data-progress-cancel]')?.addEventListener('click',()=>renderBrowser(bundle));
}
async function chooseEdition(bundle,editionId,markOwned){const e=bundle.editions.find(x=>x.id===editionId);if(!e)return;const reading=['Currently Reading','Paused'].includes(bundle.book.overall_status);if(reading)return progressChoice(bundle,e,markOwned);return applyEdition(bundle,e,markOwned,'page');}
async function applyEdition(bundle,e,markOwned,mode){
 const button=modalRoot.querySelector(`[data-edition-${markOwned?'own':'use'}="${CSS.escape(e.id)}"]`);if(button){button.disabled=true;button.textContent='Saving…';}
 try{const {error}=await supabase.rpc('select_book_edition',{p_book_id:bundle.book.id,p_edition_id:e.id,p_mark_owned:markOwned,p_progress_mode:mode,p_source:'frontend'});if(error)throw error;await window.LibraryDataCache?.clear?.();try{localStorage.removeItem('library-detail-cache-v4');localStorage.removeItem('library-enrichment-v4');}catch{}close();toast(markOwned?'Owned edition saved.':'Edition changed.');window.dispatchEvent(new CustomEvent('library-data-updated'));setTimeout(()=>location.reload(),220);}
 catch(err){toast(err.message||'Could not change edition',true);if(button){button.disabled=false;button.textContent=markOwned?'Use as my edition':'Use this edition';}}
}

async function openBrowser(bookId){
 try{activeFilter='All';const bundle=await fetchBundle(bookId);renderBrowser(bundle);const last=bundle.state.editions_last_refreshed_at?new Date(bundle.state.editions_last_refreshed_at).getTime():0;const stale=!last||Date.now()-last>30*24*60*60*1000;if(bundle.editions.length<2&&stale)setTimeout(()=>discover(bookId,false),80);}
 catch(err){toast(err.message||'Could not load editions',true);}
}

function inject(){if(!app)return;app.querySelectorAll('.detail-header[data-book-id]').forEach(detail=>{const id=detail.dataset.bookId;const list=detail.querySelector('.metadata-accordion .metadata-list');if(!id||!list||list.querySelector('[data-browse-editions]'))return;const admin=list.querySelector('.book-admin-entry');const html=`<div class="edition-browser-entry"><div><span>Edition catalogue</span><strong>Browse and switch between known editions</strong></div><button class="btn" type="button" data-browse-editions="${esc(id)}">Browse editions</button></div>`;if(admin)admin.insertAdjacentHTML('afterend',html);else list.insertAdjacentHTML('afterbegin',html);});}
document.addEventListener('click',e=>{const b=e.target.closest('[data-browse-editions]');if(!b)return;e.preventDefault();e.stopPropagation();openBrowser(b.dataset.browseEditions);},{capture:true});
if(app)new MutationObserver(()=>{if(injectQueued)return;injectQueued=true;requestAnimationFrame(()=>{injectQueued=false;inject();});}).observe(app,{childList:true,subtree:true,attributes:true,attributeFilter:['data-book-id']});
window.addEventListener('load',()=>setTimeout(inject,400));inject();
