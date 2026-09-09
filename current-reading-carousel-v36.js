import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const app=document.querySelector('#app');
const modalRoot=document.querySelector('#modal-root');
const toastNode=document.querySelector('#toast');
const ACTIVE_KEY='reading-room-current-card-v1';
let enhancing=false;
let queued=false;
let currentBooks=[];

const escSelector=value=>window.CSS?.escape?CSS.escape(String(value)):String(value).replace(/["\\]/g,'\\$&');
const clampPct=value=>{const n=Number(value);return Number.isFinite(n)?Math.max(0,Math.min(100,n)):0;};
const progressText=book=>book.current_page==null&&book.total_pages==null?'Progress not recorded':book.total_pages==null?`Page ${book.current_page??0}`:`Page ${book.current_page??0} of ${book.total_pages}`;

function palette(title=''){
 let h=2166136261;for(const ch of title)h=Math.imul(h^ch.charCodeAt(0),16777619);
 const p=[['#59422d','#1d1917'],['#2f4c48','#151c1b'],['#4a3c54','#19161d'],['#59404a','#1d1619'],['#3e4a2f','#171b13'],['#36506a','#141a20'],['#6a5134','#201912'],['#4d4439','#171512']];
 return p[Math.abs(h)%p.length];
}
function toast(message,error=false){if(!toastNode)return;toastNode.textContent=message;toastNode.className=`toast show${error?' error':''}`;clearTimeout(toastNode._current36);toastNode._current36=setTimeout(()=>toastNode.className='toast',3200);}
function closeModal(){if(modalRoot)modalRoot.innerHTML='';}
function savedActive(){try{return sessionStorage.getItem(ACTIVE_KEY)||'';}catch{return'';}}
function saveActive(id){try{sessionStorage.setItem(ACTIVE_KEY,id||'');}catch{}}

function updateHero(hero,book){
 hero.dataset.bookId=book.id;
 hero.removeAttribute('aria-hidden');
 const [a,b]=palette(book.title||'');
 const cover=hero.querySelector('.cover');if(cover){cover.style.setProperty('--cover-a',a);cover.style.setProperty('--cover-b',b);}
 let img=cover?.querySelector('img');
 if(book.cover_url){
   if(!img&&cover){img=document.createElement('img');img.loading='eager';img.alt=`Cover of ${book.title}`;cover.prepend(img);}
   if(img){img.src=book.cover_url;img.alt=`Cover of ${book.title}`;img.loading='eager';}
 }else img?.remove();
 const small=cover?.querySelector('.cover-fallback small');if(small)small.textContent=book.primary_genre||'Library';
 const strong=cover?.querySelector('.cover-fallback strong');if(strong)strong.textContent=book.title||'';
 const title=hero.querySelector('.hero-copy h1');if(title)title.textContent=book.title||'';
 const author=hero.querySelector('.hero-author');if(author)author.textContent=book.authors||'';
 const meta=hero.querySelectorAll('.progress-meta span');if(meta[0])meta[0].textContent=progressText(book);if(meta[1])meta[1].textContent=book.total_pages?`${Math.round(clampPct(book.progress_percent))}%`:'';
 const fill=hero.querySelector('.progress-fill');if(fill)fill.style.setProperty('--progress',`${clampPct(book.progress_percent)}%`);
 hero.querySelectorAll('.chapter-progress-line').forEach(x=>x.remove());
 const progress=hero.querySelector('[data-progress]');if(progress)progress.dataset.progress=book.id;
 const open=hero.querySelector('.hero-actions [data-book-id]');if(open)open.dataset.bookId=book.id;
 hero.querySelectorAll('[data-book-id]').forEach(node=>node.dataset.bookId=book.id);
 return hero;
}

function openBook(bookId){
 const nav=app?.querySelector('[data-nav="library"]');if(!nav)return;
 nav.click();
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
   const card=app?.querySelector(`.book-card[data-book-id="${escSelector(bookId)}"]`);
   card?.click();
 }));
}

function openProgress(book){
 if(!modalRoot)return;
 modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>Update ${String(book.title||'book').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')}</h2><p>${progressText(book)}</p><form id="current36-progress" class="form-stack"><div class="field"><label for="current36-page">Current page</label><input class="input" id="current36-page" name="page" type="number" min="0" ${book.total_pages?`max="${book.total_pages}"`:''} value="${book.current_page??''}" required></div><div class="field"><label for="current36-total">Total pages ${book.total_pages?'(change only if needed)':'(needed for percentage)'}</label><input class="input" id="current36-total" name="total" type="number" min="1" value="${book.total_pages??''}"></div><div class="modal-actions"><button class="btn btn-quiet" type="button" data-current36-close>Cancel</button><button class="btn btn-primary" type="submit">Save progress</button></div></form></div></div>`;
 modalRoot.querySelector('[data-current36-close]')?.addEventListener('click',closeModal);
 modalRoot.querySelector('.modal-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))closeModal();});
 modalRoot.querySelector('#current36-progress')?.addEventListener('submit',async e=>{
   e.preventDefault();const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Saving…';
   try{
     const page=Number(e.currentTarget.page.value),total=e.currentTarget.total.value?Number(e.currentTarget.total.value):null;
     if(total&&total!==Number(book.total_pages)){const set=await supabase.rpc('set_reading_page_count',{p_book_id:book.id,p_total_pages:total,p_source:'frontend'});if(set.error)throw set.error;}
     const result=await supabase.rpc('update_reading_progress',{p_book_id:book.id,p_page:page,p_source:'frontend'});if(result.error)throw result.error;
     await window.LibraryDataCache?.clear?.();closeModal();toast('Progress updated.');window.dispatchEvent(new CustomEvent('library-data-updated',{detail:{bookId:book.id}}));app?.querySelector('#refresh')?.click();
   }catch(err){toast(err?.message||'Could not update progress',true);button.disabled=false;button.textContent='Save progress';}
 });
}

function bindClone(hero,book){
 hero.addEventListener('click',e=>{
   const progress=e.target.closest('[data-progress]');if(progress){e.preventDefault();e.stopPropagation();openProgress(book);return;}
   if(e.target.closest('button')&&!e.target.closest('[data-book-id]'))return;
   e.preventDefault();e.stopPropagation();openBook(book.id);
 });
}

function setActive(wrapper,index,{persist=true}={}){
 const track=wrapper.querySelector('.current-reading-track-v36');const cards=[...track.querySelectorAll('.hero')];if(!cards.length)return;
 const safe=Math.max(0,Math.min(cards.length-1,index));
 wrapper.dataset.currentIndex=String(safe);
 const indicator=wrapper.querySelector('.current-reading-indicator-v36');const slot=wrapper.querySelector(`[data-current-dot="${safe}"]`);
 if(indicator&&slot)indicator.style.transform=`translate3d(${slot.offsetLeft}px,0,0)`;
 wrapper.querySelectorAll('[data-current-dot]').forEach((dot,i)=>dot.setAttribute('aria-current',i===safe?'true':'false'));
 if(persist)saveActive(cards[safe].dataset.bookId||'');
}
function activeFromScroll(wrapper){
 const track=wrapper.querySelector('.current-reading-track-v36');if(!track)return;
 const cards=[...track.querySelectorAll('.hero')];if(!cards.length)return;
 let best=0,bestDist=Infinity;const center=track.scrollLeft+track.clientWidth/2;
 cards.forEach((card,i)=>{const cardCenter=card.offsetLeft+card.offsetWidth/2,dist=Math.abs(cardCenter-center);if(dist<bestDist){bestDist=dist;best=i;}});
 setActive(wrapper,best);
}
function bindCarousel(wrapper){
 const track=wrapper.querySelector('.current-reading-track-v36');if(!track)return;
 let raf=0;track.addEventListener('scroll',()=>{if(raf)return;raf=requestAnimationFrame(()=>{raf=0;activeFromScroll(wrapper);});},{passive:true});
 wrapper.querySelectorAll('[data-current-dot]').forEach(dot=>dot.addEventListener('click',()=>{
   const index=Number(dot.dataset.currentDot),card=track.querySelectorAll('.hero')[index];if(!card)return;
   track.scrollTo({left:card.offsetLeft,behavior:'smooth'});setActive(wrapper,index);
 }));
 if('ResizeObserver'in window){const ro=new ResizeObserver(()=>setActive(wrapper,Number(wrapper.dataset.currentIndex||0),{persist:false}));ro.observe(wrapper);}
}

async function enhance(){
 if(enhancing||!app||document.hidden)return;
 if(app.querySelector('#current-reading-carousel-v36'))return;
 const source=app.querySelector('main > .hero[data-book-id]');if(!source)return;
 enhancing=true;
 try{
   const {data:{session}}=await supabase.auth.getSession();if(!session)return;
   const {data,error}=await supabase.from('v_library').select('*').eq('overall_status','Currently Reading').order('started_at',{ascending:true,nullsFirst:false});
   if(error||!data?.length)return;
   if(!source.isConnected||app.querySelector('#current-reading-carousel-v36'))return;
   const firstId=source.dataset.bookId;
   currentBooks=[...data].sort((x,y)=>Number(y.id===firstId)-Number(x.id===firstId));
   const wrapper=document.createElement('div');wrapper.id='current-reading-carousel-v36';wrapper.className='current-reading-carousel-v36';
   const track=document.createElement('div');track.className='current-reading-track-v36';track.setAttribute('aria-label','Currently reading books');
   source.before(wrapper);wrapper.appendChild(track);track.appendChild(source);
   source.classList.add('current-reading-card-v36');
   currentBooks.forEach((book,index)=>{
     if(index===0){source.dataset.bookId=book.id;return;}
     const clone=source.cloneNode(true);clone.classList.add('current-reading-card-v36');clone.removeAttribute('id');updateHero(clone,book);bindClone(clone,book);track.appendChild(clone);
   });
   const dots=document.createElement('div');dots.className='current-reading-dots-v36';dots.setAttribute('aria-label',`${currentBooks.length} currently reading ${currentBooks.length===1?'book':'books'}`);
   const rail=document.createElement('div');rail.className='current-reading-dot-rail-v36';
   currentBooks.forEach((book,index)=>{const dot=document.createElement('button');dot.type='button';dot.className='current-reading-dot-v36';dot.dataset.currentDot=String(index);dot.setAttribute('aria-label',`Show ${book.title}`);rail.appendChild(dot);});
   const indicator=document.createElement('span');indicator.className='current-reading-indicator-v36';indicator.setAttribute('aria-hidden','true');rail.appendChild(indicator);dots.appendChild(rail);wrapper.appendChild(dots);
   bindCarousel(wrapper);
   const remembered=savedActive();const found=currentBooks.findIndex(b=>b.id===remembered),start=found>=0?found:0;
   requestAnimationFrame(()=>{
     const card=track.querySelectorAll('.hero')[start];if(start>0&&card)track.scrollLeft=card.offsetLeft;
     setActive(wrapper,start,{persist:false});
     window.dispatchEvent(new CustomEvent('reading-room-current-carousel-ready'));
   });
 }catch(err){console.info('[Reading Room] current reading carousel unavailable',err?.message||err);}finally{enhancing=false;}
}
function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;enhance();});}

if(app)new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
window.addEventListener('load',()=>setTimeout(enhance,450));
window.addEventListener('library-data-updated',()=>setTimeout(schedule,120));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)setTimeout(schedule,150);});
supabase.auth.onAuthStateChange((_event,session)=>{if(session)setTimeout(schedule,250);});
