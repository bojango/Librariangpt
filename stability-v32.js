const app=document.querySelector('#app');
const modalRoot=document.querySelector('#modal-root');
const VIEW_STATE_KEY='reading-room-view-state-v32';
const STABILITY_MARKER='reading-room-stability-v32';
let lastRoute='';
let restoreTimer=0;
let mutationQueued=false;
let manualForcedEnrichmentUntil=0;
const startupQuietUntil=Date.now()+45000;

function readState(){try{return JSON.parse(sessionStorage.getItem(VIEW_STATE_KEY)||'{"pages":{}}');}catch{return{pages:{}};}}
function writeState(s){try{sessionStorage.setItem(VIEW_STATE_KEY,JSON.stringify(s));}catch{}}
function activePage(){return app?.querySelector('.nav-btn.active[data-nav]')?.dataset.nav||'home';}
function routeKey(){const d=app?.querySelector('.detail-header');if(d){const id=d.dataset.bookId||d.querySelector('[data-book-id]')?.dataset.bookId||d.querySelector('h1')?.textContent?.trim()||'book';return`detail:${id}`;}return`page:${activePage()}`;}
function pageKey(){return activePage();}
function topbarHeight(){return app?.querySelector('.topbar')?.getBoundingClientRect().height||0;}

function horizontalAreas(){
 const out=[];
 app?.querySelectorAll('.shelf,.recommended-row,[class*="up-next"][class*="row"],.up-next-row').forEach((el,i)=>{
  if(!(el instanceof HTMLElement))return;
  const section=el.closest('.section');
  const heading=section?.querySelector('h2')?.textContent?.trim()||el.className||`row-${i}`;
  out.push({key:`${heading}:${i}`,left:el.scrollLeft});
 });
 return out;
}

function visibleBookAnchor(){
 const cutoff=topbarHeight()+4;
 const cards=[...(app?.querySelectorAll('.book-card[data-book-id]')||[])];
 let best=null;
 for(const card of cards){
  const r=card.getBoundingClientRect();
  if(r.bottom<=cutoff||r.top>=window.innerHeight)continue;
  if(!best||Math.abs(r.top-cutoff)<Math.abs(best.offset-cutoff))best={id:card.dataset.bookId,offset:r.top};
 }
 return best;
}

function saveCurrentPage(){
 if(!app||app.querySelector('.detail-header'))return;
 const key=pageKey();
 const state=readState();state.pages=state.pages||{};
 state.pages[key]={y:window.scrollY,anchor:visibleBookAnchor(),horizontal:horizontalAreas(),savedAt:Date.now()};
 writeState(state);
}

function restoreHorizontal(saved=[]){
 const rows=[...(app?.querySelectorAll('.shelf,.recommended-row,[class*="up-next"][class*="row"],.up-next-row')||[])];
 rows.forEach((el,i)=>{
  const section=el.closest('.section');const heading=section?.querySelector('h2')?.textContent?.trim()||el.className||`row-${i}`;
  const hit=saved.find(x=>x.key===`${heading}:${i}`);if(hit)el.scrollLeft=Number(hit.left)||0;
 });
}

function primeVisibleImages(){
 const pad=window.innerHeight*.75;
 document.querySelectorAll('#app img[loading="lazy"]').forEach(img=>{
  const r=img.getBoundingClientRect();
  if(r.bottom>-pad&&r.top<window.innerHeight+pad){img.loading='eager';img.decoding='async';}
 });
}

function restorePage(key){
 const state=readState();const saved=state.pages?.[key];
 if(!saved){window.scrollTo({top:0,left:0,behavior:'instant'});primeVisibleImages();return;}
 let restored=false;
 if(saved.anchor?.id){
  const card=app?.querySelector(`.book-card[data-book-id="${CSS.escape(saved.anchor.id)}"]`);
  if(card){const r=card.getBoundingClientRect();const target=window.scrollY+r.top-Number(saved.anchor.offset||topbarHeight());window.scrollTo({top:Math.max(0,target),left:0,behavior:'instant'});restored=true;}
 }
 if(!restored){const max=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);window.scrollTo({top:Math.min(Number(saved.y)||0,max),left:0,behavior:'instant'});}
 restoreHorizontal(saved.horizontal||[]);primeVisibleImages();
}

function scheduleRouteSettle(route){
 clearTimeout(restoreTimer);
 const detail=route.startsWith('detail:');
 requestAnimationFrame(()=>requestAnimationFrame(()=>{
  if(routeKey()!==route)return;
  document.body.classList.toggle('rr-detail-page',detail);
  if(detail){window.scrollTo({top:0,left:0,behavior:'instant'});primeVisibleImages();}
  else restorePage(route.slice(5));
  void app?.offsetHeight;
  restoreTimer=setTimeout(()=>{
   if(routeKey()!==route)return;
   if(!detail)restorePage(route.slice(5));
   primeVisibleImages();
  },140);
 }));
}

function inspectRoute(){
 if(!app)return;
 const route=routeKey();
 document.body.classList.toggle('rr-detail-page',route.startsWith('detail:'));
 if(route!==lastRoute){lastRoute=route;scheduleRouteSettle(route);}
 else requestAnimationFrame(primeVisibleImages);
}

// Capture view state before the core SPA replaces the current DOM.
document.addEventListener('click',e=>{
 const target=e.target;
 if(!(target instanceof Element))return;
 if(target.closest('[data-v4-refresh-data]'))manualForcedEnrichmentUntil=Date.now()+12000;
 if(target.closest('[data-nav],[data-back],.book-card[data-book-id],.hero[data-book-id]'))saveCurrentPage();
},{capture:true});

// The old performance module launches a batch of forced metadata repair calls about a second after startup.
// Quiet those during the first 45s, while still allowing an explicit "Refresh book data" click through.
const previousFetch=window.fetch.bind(window);
window.fetch=async(input,init={})=>{
 let request;
 try{request=input instanceof Request?input:new Request(input,init);}catch{return previousFetch(input,init);}
 try{
  const u=new URL(request.url);
  if(request.method==='POST'&&u.hostname.endsWith('.supabase.co')&&u.pathname.endsWith('/functions/v1/content-enrichment')&&Date.now()<startupQuietUntil&&Date.now()>manualForcedEnrichmentUntil){
   const body=await request.clone().json().catch(()=>null);
   if(body?.force===true)return new Response(JSON.stringify({ok:true,deferred:true,reason:'startup-stability-window'}),{status:200,headers:{'Content-Type':'application/json'}});
  }
 }catch{}
 return previousFetch(input,init);
};

// One controlled observer replaces the need to depend on a scroll/tap before Safari paints newly inserted sections.
if(app)new MutationObserver(()=>{
 if(mutationQueued)return;mutationQueued=true;
 requestAnimationFrame(()=>{mutationQueued=false;inspectRoute();void app.offsetHeight;requestAnimationFrame(primeVisibleImages);});
}).observe(app,{childList:true,subtree:true});

window.addEventListener('pageshow',()=>{inspectRoute();setTimeout(()=>{inspectRoute();primeVisibleImages();},80);});
window.addEventListener('resize',()=>requestAnimationFrame(primeVisibleImages),{passive:true});
window.addEventListener('scroll',()=>requestAnimationFrame(primeVisibleImages),{passive:true});

// Clear the obsolete volatile cache once when this stability build first runs.
try{if(localStorage.getItem(STABILITY_MARKER)!=='1'){localStorage.setItem(STABILITY_MARKER,'1');window.LibraryDataCache?.clear?.();}}catch{}
inspectRoute();
