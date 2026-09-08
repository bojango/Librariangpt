import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const app=document.querySelector('#app');
const modalRoot=document.querySelector('#modal-root');
const toastNode=document.querySelector('#toast');
let recommendations=[];
let loading=false;
let observerPending=false;
let pageOpen=false;

const esc=(v='')=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
function toast(message,error=false){if(!toastNode)return;toastNode.textContent=message;toastNode.className=`toast show${error?' error':''}`;clearTimeout(toastNode._recommended);toastNode._recommended=setTimeout(()=>toastNode.className='toast',3200);}
function palette(title=''){let h=2166136261;for(const ch of title)h=Math.imul(h^ch.charCodeAt(0),16777619);const p=[['#6f7f70','#283129'],['#766c84','#2f2a36'],['#8c735f','#332820'],['#657d8c','#253039'],['#8a6d71','#35282b'],['#777b58','#2c3020']];return p[Math.abs(h)%p.length];}
function coverMarkup(book,className='recommended-cover'){const[a,b]=palette(book.title);return `<div class="${className}" style="--a:${a};--b:${b}">${book.cover_url?`<img src="${esc(book.cover_url)}" alt="Cover of ${esc(book.title)}" loading="lazy" onerror="this.remove()">`:''}<div class="recommended-cover-fallback"><small>${esc(book.primary_genre||'Recommended')}</small><strong>${esc(book.title)}</strong></div></div>`;}
function fitLabel(item){return item.recommendation_strength==='Wildcard'?'Wildcard':item.recommendation_strength||'Recommended';}
function scoreLabel(item){const score=Number(item.match_score_10);return Number.isFinite(score)?`${score.toFixed(1)}/10${item.match_confidence?` · ${esc(item.match_confidence)} confidence`:''}`:(item.match_confidence?`${esc(item.match_confidence)} confidence`:'');}

async function loadRecommendations(){
 if(loading)return;loading=true;
 try{
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){recommendations=[];renderShelf();return;}
  const {data,error}=await supabase.from('v_ai_recommendations').select('*').order('display_rank',{ascending:true});
  if(error)throw error;
  recommendations=(data||[]).slice(0,20);
  renderShelf();
  if(pageOpen)renderPage();
 }catch(e){console.info('[Library] AI recommendations unavailable',e?.message||e);}
 finally{loading=false;}
}

function findOwnedSection(){return [...document.querySelectorAll('main .section')].find(s=>s.querySelector('h2')?.textContent?.trim().toLowerCase()==='owned & unread')||null;}
function removeLegacyShelf(){[...document.querySelectorAll('main .section')].forEach(s=>{if(s.id!=='ai-recommended-section'&&s.querySelector('h2')?.textContent?.trim().toLowerCase()==='recommended for you')s.remove();});}
function featured(){const chosen=recommendations.filter(x=>x.frontend_featured).sort((a,b)=>(a.display_rank||999)-(b.display_rank||999));return (chosen.length?chosen:recommendations).slice(0,5);}
function card(item){const reason=item.why_recommended||'Recommended from your current Taste Profile and reading feedback.';return `<article class="recommended-card ${item.recommendation_strength==='Wildcard'?'is-wildcard':''}" data-recommendation-id="${item.recommendation_id}" tabindex="0" role="button" aria-label="Open recommendation for ${esc(item.title)}">${coverMarkup(item)}<div class="recommended-copy"><div class="recommended-card-top"><span class="recommended-badge ${item.recommendation_strength==='Wildcard'?'wildcard':''}">${esc(fitLabel(item))}</span>${item.match_score_10!=null?`<span class="recommended-card-score">${Number(item.match_score_10).toFixed(1)}</span>`:''}</div><h3>${esc(item.title)}</h3><p class="recommended-author">${esc(item.authors||'Unknown author')}</p><p class="recommended-reason">${esc(reason)}</p></div></article>`;}

function positionShelf(section){
 const owned=findOwnedSection();
 if(!owned){section?.remove();return false;}
 const upNext=document.querySelector('#up-next-section');
 if(upNext){if(upNext.nextElementSibling!==section)upNext.after(section);}
 else if(owned.previousElementSibling!==section)owned.before(section);
 return true;
}
function renderShelf(){
 removeLegacyShelf();
 const owned=findOwnedSection();
 let section=document.querySelector('#ai-recommended-section');
 if(!owned){section?.remove();return;}
 if(!section){section=document.createElement('section');section.id='ai-recommended-section';section.className='section ai-recommended-section';owned.before(section);}
 positionShelf(section);
 const picks=featured();
 const signature=picks.map(x=>`${x.recommendation_id}:${x.display_rank}:${x.frontend_featured}:${x.cover_url||''}:${x.why_recommended||''}`).join('|')+`|${recommendations.length}`;
 if(section.dataset.signature===signature)return;
 section.dataset.signature=signature;
 section.innerHTML=`<div class="section-header"><div><h2>Recommended for you</h2><p class="recommended-section-note">AI picks from beyond your library, shaped by what you actually enjoy.</p></div><button class="recommended-more" id="recommended-see-more" type="button" ${recommendations.length?'':'disabled'}>See more</button></div>${picks.length?`<div class="recommended-row">${picks.map(card).join('')}</div>`:'<div class="empty-shelf">No active recommendations right now.</div>'}`;
 section.querySelector('#recommended-see-more')?.addEventListener('click',openPage);
 bindCards(section);
}

function bindCards(root){root.querySelectorAll('[data-recommendation-id]').forEach(node=>{
  const open=()=>{const item=recommendations.find(x=>x.recommendation_id===node.dataset.recommendationId);if(item)openDetails(item);};
  node.addEventListener('click',open);
  node.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();open();}});
 });
}

function modal(html){
 modalRoot.innerHTML=`<div class="modal-backdrop recommended-detail-backdrop"><div class="modal recommended-detail-modal">${html}</div></div>`;
 modalRoot.querySelectorAll('[data-recommended-close]').forEach(b=>b.addEventListener('click',()=>modalRoot.innerHTML=''));
 modalRoot.querySelector('.modal-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))modalRoot.innerHTML='';});
}
function openDetails(item){
 const reason=item.why_recommended||'Recommended from your current Taste Profile and reading feedback.';
 const meta=[item.fiction_nonfiction,item.page_count?`${Number(item.page_count).toLocaleString('en-GB')} pages`:null].filter(Boolean).join(' · ');
 modal(`<div class="recommended-detail-shell"><button class="recommended-detail-close" type="button" data-recommended-close aria-label="Close">×</button><div class="recommended-detail-head">${coverMarkup(item,'recommended-detail-cover')}<div class="recommended-detail-meta"><div class="recommended-detail-flags"><span class="recommended-badge ${item.recommendation_strength==='Wildcard'?'wildcard':''}">${esc(fitLabel(item))}</span></div><h2>${esc(item.title)}</h2><p class="recommended-detail-author">${esc(item.authors||'Unknown author')}</p><p class="recommended-book-meta">${esc(meta||item.primary_genre||'Book')}</p>${scoreLabel(item)?`<p class="recommended-detail-score">Match ${scoreLabel(item)}</p>`:''}</div></div><div class="recommended-detail-reason"><h3>Why I’m recommending it</h3><p>${esc(reason)}</p></div><div class="recommended-detail-actions"><button class="btn btn-primary" id="recommended-add-wishlist" type="button">Add to wish list</button></div></div>`);
 modalRoot.querySelector('#recommended-add-wishlist')?.addEventListener('click',e=>addToWishlist(item,e.currentTarget));
}

async function addToWishlist(item,button){
 button.disabled=true;button.textContent='Adding…';
 try{
  const {error}=await supabase.rpc('recommendation_add_to_wishlist',{p_recommendation_id:item.recommendation_id});
  if(error)throw error;
  await window.LibraryDataCache?.clear?.();
  modalRoot.innerHTML='';
  toast(`${item.title} added to your wish list.`);
  loading=false;await loadRecommendations();
  window.dispatchEvent(new CustomEvent('library-data-updated'));
  setTimeout(()=>document.querySelector('#refresh')?.click(),120);
 }catch(e){toast(e.message||'Could not add this book to your wish list',true);button.disabled=false;button.textContent='Add to wish list';}
}

function listCard(item){const reason=item.why_recommended||'Recommended from your current Taste Profile and reading feedback.';return `<article class="recommended-list-card ${item.recommendation_strength==='Wildcard'?'is-wildcard':''}" data-recommendation-id="${item.recommendation_id}" tabindex="0" role="button"><div class="recommended-list-rank">${String(item.display_rank||'').padStart(2,'0')}</div>${coverMarkup(item,'recommended-list-cover')}<div class="recommended-list-copy"><div class="recommended-list-flags"><span class="recommended-badge ${item.recommendation_strength==='Wildcard'?'wildcard':''}">${esc(fitLabel(item))}</span>${item.match_score_10!=null?`<span>${Number(item.match_score_10).toFixed(1)}/10</span>`:''}</div><h2>${esc(item.title)}</h2><p class="recommended-author">${esc(item.authors||'Unknown author')}</p><p class="recommended-list-meta">${esc([item.fiction_nonfiction,item.page_count?`${item.page_count} pages`:null].filter(Boolean).join(' · '))}</p><p class="recommended-list-reason">${esc(reason)}</p></div></article>`;}
function renderPage(){
 let layer=document.querySelector('#recommended-page-layer');
 if(!pageOpen){layer?.remove();return;}
 if(!layer){layer=document.createElement('div');layer.id='recommended-page-layer';layer.className='recommended-page-layer';document.body.appendChild(layer);}
 layer.innerHTML=`<div class="recommended-page-shell"><header class="recommended-page-header"><button class="recommended-back" id="recommended-back" type="button" aria-label="Back">←</button><div><p class="eyebrow">AI discovery</p><h1>Recommended for you</h1><p>${recommendations.length} active picks outside your library, ranked against your current Taste Profile.</p></div></header><main class="recommended-page-main">${recommendations.length?`<div class="recommended-list">${recommendations.map(listCard).join('')}</div>`:'<div class="empty-shelf">No active recommendations right now.</div>'}</main></div>`;
 layer.querySelector('#recommended-back')?.addEventListener('click',closePage);
 bindCards(layer);
 requestAnimationFrame(()=>layer.classList.add('is-open'));
}
function openPage(){pageOpen=true;renderPage();document.body.classList.add('recommended-page-open');}
function closePage(){pageOpen=false;document.body.classList.remove('recommended-page-open');document.querySelector('#recommended-page-layer')?.remove();}

function scheduleRender(){if(observerPending)return;observerPending=true;requestAnimationFrame(()=>{observerPending=false;renderShelf();});}
if(app)new MutationObserver(scheduleRender).observe(app,{childList:true,subtree:true});
window.addEventListener('load',()=>setTimeout(loadRecommendations,650));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(()=>{loading=false;loadRecommendations();},300);});
window.addEventListener('online',()=>setTimeout(()=>{loading=false;loadRecommendations();},300));
window.addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(modalRoot?.innerHTML){modalRoot.innerHTML='';return;}if(pageOpen)closePage();});
supabase.auth.onAuthStateChange((_e,s)=>{if(s)setTimeout(()=>{loading=false;loadRecommendations();},400);else{recommendations=[];document.querySelector('#ai-recommended-section')?.remove();closePage();}});
window.addEventListener('library-data-updated',()=>setTimeout(()=>{loading=false;loadRecommendations();},180));
