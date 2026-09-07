import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const app=document.querySelector('#app');
const modalRoot=document.querySelector('#modal-root');
const toastNode=document.querySelector('#toast');
const DETAIL_CACHE_KEY='library-detail-cache-v4';
const ENRICH_KEY='library-enrichment-v4';
const DETAIL_TTL=30*60*1000;
let busyDetail=false;
let lastScrollY=0;

const esc=(v='')=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const fmtDate=v=>v?new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(v)):'Not recorded';
const fmtRating=v=>v==null?'—':Number(v).toFixed(2);
const fmtCount=v=>v==null?'':new Intl.NumberFormat('en-GB',{notation:Number(v)>=100000?'compact':'standard',maximumFractionDigits:1}).format(Number(v));
const norm=v=>String(v||'').trim().toLowerCase();

function readJson(key,fallback={}){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback));}catch{return fallback;}}
function writeJson(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
function cacheKey(title,author){return `${norm(title)}|${norm(author)}`;}
function detailCache(){return readJson(DETAIL_CACHE_KEY,{});}
function saveDetail(bundle){const all=detailCache();all[cacheKey(bundle.book.title,bundle.book.authors)]={savedAt:Date.now(),bundle};writeJson(DETAIL_CACHE_KEY,all);}
function cachedDetail(title,author){return detailCache()[cacheKey(title,author)]||null;}
async function clearDataCache(){localStorage.removeItem(DETAIL_CACHE_KEY);localStorage.removeItem(ENRICH_KEY);await window.LibraryDataCache?.clear?.();}
function toast(message,error=false){if(!toastNode)return;toastNode.textContent=message;toastNode.className=`toast show${error?' error':''}`;clearTimeout(toastNode._v4);toastNode._v4=setTimeout(()=>toastNode.className='toast',3600);}
function modal(html){modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal">${html}</div></div>`;modalRoot.querySelectorAll('[data-v4-close]').forEach(x=>x.addEventListener('click',()=>modalRoot.innerHTML=''));modalRoot.querySelector('.modal-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))modalRoot.innerHTML='';});}
async function fn(name,body){const {data,error}=await supabase.functions.invoke(name,{body});if(error)throw error;if(data?.error)throw new Error(data.error);return data;}

function providerLogo(provider=''){
 const p=provider.toLowerCase();
 if(p.includes('goodreads'))return './assets/goodreads.svg';
 if(p.includes('google'))return './assets/google-books.svg';
 if(p.includes('open library'))return './assets/open-library.svg';
 return null;
}
function ratingCard(r){const logo=providerLogo(r.provider);const count=r.rating_count!=null?`${fmtCount(r.rating_count)} ratings`:'Public score';const inner=`${logo?`<img src="${logo}" alt="${esc(r.provider)} logo">`:`<span class="rating-fallback">★</span>`}<span class="rating-copy"><strong>${fmtRating(r.rating_5)}<small>/5</small></strong><span>${esc(r.provider||'Public')} · ${esc(count)}</span></span>`;return r.source_url?`<a class="rating-card rating-public" href="${esc(r.source_url)}" target="_blank" rel="noreferrer">${inner}</a>`:`<div class="rating-card rating-public">${inner}</div>`;}
function userRatingCard(book){const has=book.user_rating_5!=null;return `<button class="rating-card rating-user" type="button" data-v4-review="${book.id}"><span class="rating-user-mark">YOU</span><span class="rating-copy"><strong>${has?fmtRating(book.user_rating_5):'Rate'}${has?'<small>/5</small>':''}</strong><span>${has?'Your rating · tap to edit':'Add your rating & review'}</span></span></button>`;}
function shortSynopsis(text,max=390){const clean=String(text||'').replace(/\s+/g,' ').trim();if(clean.length<=max)return{short:clean,full:clean,truncated:false};let cut=clean.slice(0,max);cut=cut.slice(0,Math.max(cut.lastIndexOf(' '),max-45)).trim();return{short:`${cut}…`,full:clean,truncated:true};}
function metadataRows(book){
 const rows=[['ISBN',book.isbn13||book.isbn10],['Publisher',[book.publisher,book.imprint].filter(Boolean).join(' · ')],['Edition',[book.edition_year,book.edition_format].filter(Boolean).join(' · ')],['Edition statement',book.edition_statement],['Printing / impression',book.printing_impression],['Printer code / number line',book.number_line],['Original publication',book.original_publication_year],['Language',book.language],['Country',book.country],['Series',book.series?`${book.series}${book.series_order?` #${book.series_order}`:''}`:null],['Signed',book.signed===true?'Yes':book.signed===false?'No':null],['Condition',book.condition],['Dimensions',book.physical_dimensions],['Metadata source',book.edition_metadata_source]].filter(([,v])=>v!==null&&v!==undefined&&String(v).trim()!=='');
 const pages=book.edition_page_count||book.total_pages;
 const pageRow=`<div class="metadata-row"><span>Pages</span><strong class="metadata-edit-value">${pages?esc(pages):'Not recorded'} <button class="text-action" type="button" data-v4-pages="${book.id}">Edit</button></strong></div>`;
 return pageRow+rows.map(([k,v])=>`<div class="metadata-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
}

async function fetchBundle(title,author,force=false){
 const {data:rows,error}=await supabase.from('v_library').select('*').eq('title',title);if(error||!rows?.length)throw error||new Error('Book not found');
 const book=rows.find(x=>norm(x.authors)===norm(author))||rows[0];
 let [{data:ratings},{data:rec}]=await Promise.all([
  supabase.from('public_ratings').select('provider,rating_5,rating_count,review_count,source_url,is_primary,fetched_at').eq('book_id',book.id).order('is_primary',{ascending:false}).order('fetched_at',{ascending:false}),
  supabase.from('recommendations').select('why_recommended,match_score_10,outcome,recommendation_strength').eq('book_id',book.id).order('date_recommended',{ascending:false}).limit(1).maybeSingle()
 ]);
 const needs=!book.synopsis||!(ratings||[]).length;
 const enrich=readJson(ENRICH_KEY,{});const last=Number(enrich[book.id]||0);
 if((needs||force)&&(force||Date.now()-last>24*60*60*1000)){
  enrich[book.id]=Date.now();writeJson(ENRICH_KEY,enrich);
  try{await fn('content-enrichment',{book_id:book.id,force});await window.LibraryDataCache?.clear?.();const fresh=await supabase.from('v_library').select('*').eq('id',book.id).single();if(!fresh.error&&fresh.data)Object.assign(book,fresh.data);const rr=await supabase.from('public_ratings').select('provider,rating_5,rating_count,review_count,source_url,is_primary,fetched_at').eq('book_id',book.id).order('is_primary',{ascending:false}).order('fetched_at',{ascending:false});ratings=rr.data||ratings;}catch(e){console.info('[Library] enrichment unavailable',e?.message||e);}
 }
 const bundle={book,ratings:ratings||[],rec:rec||null};saveDetail(bundle);return bundle;
}

function parseCurrentDetail(detail){return{title:detail.querySelector('.detail-copy h1')?.textContent?.trim(),author:detail.querySelector('.hero-author')?.textContent?.trim()};}
function renderDetail(detail,bundle){
 const {book,ratings,rec}=bundle;const oldCopy=detail.querySelector('.detail-copy');if(!oldCopy)return;
 const progress=oldCopy.querySelector('.progress-block');const actions=oldCopy.querySelector('.detail-actions');
 const copy=document.createElement('div');copy.className='detail-copy detail-copy-v4';
 const tags=[book.overall_status,book.ownership_status,book.primary_genre,book.edition_format].filter(Boolean);
 const goodreads=ratings.find(r=>norm(r.provider).includes('goodreads'))||ratings[0]||null;
 const otherRatings=ratings.filter(r=>r!==goodreads);
 const syn=shortSynopsis(book.synopsis||'Synopsis not available yet.');
 const reviewText=book.review_notes||book.user_review||'';
 copy.innerHTML=`<p class="eyebrow">${esc(book.fiction_nonfiction||'Book')}</p><h1>${esc(book.title)}</h1><div class="hero-author">${esc(book.authors||'Unknown author')}</div><div class="meta">${tags.map(t=>`<span class="badge">${esc(t)}</span>`).join('')}${rec?.match_score_10!=null?`<span class="badge accent">Predicted fit ${Number(rec.match_score_10).toFixed(1)}/10</span>`:''}</div>
 <div class="rating-strip rating-primary-row">${goodreads?ratingCard(goodreads):'<div class="rating-card rating-public rating-empty-card"><span class="rating-fallback">★</span><span class="rating-copy"><strong>—</strong><span>Public rating unavailable</span></span></div>'}${userRatingCard(book)}</div>
 ${otherRatings.length?`<div class="other-ratings">${otherRatings.map(ratingCard).join('')}</div>`:''}
 <section class="book-synopsis"><h2>Synopsis</h2><p><span class="synopsis-text">${esc(syn.short)}</span>${syn.truncated?` <button class="read-more" type="button" data-v4-synopsis="${book.id}">Read more</button>`:''}</p></section>
 <div class="reading-slot"></div><div class="actions-slot"></div>
 ${reviewText?`<section class="review-panel"><p class="eyebrow">Your review</p><p>${esc(reviewText)}</p><button class="text-action" type="button" data-v4-review="${book.id}">Edit rating & review</button></section>`:''}
 <div class="reading-dates"><div><small>Started</small><strong>${fmtDate(book.started_at)}</strong></div><div><small>Finished</small><strong>${fmtDate(book.completed_at)}</strong></div><div><small>Length</small><strong>${book.total_pages?`${esc(book.total_pages)} pages`:'Not recorded'}</strong></div></div>
 ${rec?.why_recommended?`<section class="recommendation-panel"><p class="eyebrow">Librarian note</p><h2>Why it was recommended</h2><p>${esc(rec.why_recommended)}</p>${rec.outcome?`<span class="badge">Prediction: ${esc(rec.outcome)}</span>`:''}</section>`:''}
 <details class="metadata-accordion"><summary><span><strong>Book & edition details</strong><small>ISBN, publisher, printing, format and source data</small></span><span class="accordion-plus">+</span></summary><div class="metadata-list">${metadataRows(book)}<div class="metadata-row"><span>Data</span><strong><button class="text-action" data-v4-refresh-data="${book.id}">Refresh book data</button></strong></div></div></details>`;
 oldCopy.replaceWith(copy);
 if(progress)copy.querySelector('.reading-slot')?.append(progress);
 if(actions){if(!actions.querySelector('[data-v4-cover]'))actions.insertAdjacentHTML('beforeend',`<button class="btn" data-v4-cover="${book.id}">Edit cover</button>`);copy.querySelector('.actions-slot')?.append(actions);}
 detail.dataset.libraryDetail='ready';detail.dataset.bookId=book.id;
 copy.querySelectorAll('[data-v4-review]').forEach(b=>b.addEventListener('click',()=>openReview(book)));
 copy.querySelector('[data-v4-cover]')?.addEventListener('click',()=>openCoverPicker(book));
 copy.querySelector('[data-v4-pages]')?.addEventListener('click',()=>openPageCount(book));
 copy.querySelector('[data-v4-refresh-data]')?.addEventListener('click',()=>refreshBookData(book));
 const more=copy.querySelector('[data-v4-synopsis]');if(more)more.addEventListener('click',()=>{const text=copy.querySelector('.synopsis-text');const expanded=more.dataset.expanded==='1';text.textContent=expanded?syn.short:syn.full;more.textContent=expanded?'Read more':'Show less';more.dataset.expanded=expanded?'0':'1';});
}

async function enhanceDetail(){if(busyDetail||!app)return;const detail=app.querySelector('.detail-header');if(!detail||detail.dataset.libraryDetail==='ready'||detail.dataset.libraryDetail==='loading')return;busyDetail=true;detail.dataset.libraryDetail='loading';try{const parsed=parseCurrentDetail(detail);if(!parsed.title){delete detail.dataset.libraryDetail;return;}const cached=cachedDetail(parsed.title,parsed.author);if(cached?.bundle)renderDetail(detail,cached.bundle);if(!cached||Date.now()-Number(cached.savedAt)>DETAIL_TTL){const bundle=await fetchBundle(parsed.title,parsed.author,false);if(document.body.contains(detail))renderDetail(detail,bundle);}}catch(e){console.info('[Library] detail load failed',e?.message||e);delete detail.dataset.libraryDetail;}finally{busyDetail=false;}}

function openReview(book){
 modal(`<h2>${book.user_rating_5!=null?'Edit':'Add'} your rating</h2><p>Use the stars for a quick score or type a precise X.XX rating. Notes become reading feedback for future recommendations.</p><form id="v4-review-form" class="form-stack"><div class="quick-stars" aria-label="Quick rating">${[1,2,3,4,5].map(n=>`<button type="button" data-v4-star="${n}" aria-label="${n} stars">★</button>`).join('')}</div><div class="field"><label for="v4-rating">Your rating / 5</label><input class="input rating-input" id="v4-rating" type="number" min="0" max="5" step="0.01" inputmode="decimal" value="${book.user_rating_5??''}" placeholder="4.25" required></div><div class="field"><label for="v4-notes">Review notes</label><textarea class="input" id="v4-notes" rows="7" placeholder="What worked? What dragged? What should future recommendations learn from this?">${esc(book.review_notes||book.user_review||'')}</textarea></div><div class="modal-actions"><button class="btn" type="button" data-v4-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`);
 const input=modalRoot.querySelector('#v4-rating');
 modalRoot.querySelectorAll('[data-v4-star]').forEach(b=>b.addEventListener('click',()=>{input.value=b.dataset.v4Star;modalRoot.querySelectorAll('[data-v4-star]').forEach(s=>s.classList.toggle('active',Number(s.dataset.v4Star)<=Number(b.dataset.v4Star)));}));
 modalRoot.querySelector('#v4-review-form')?.addEventListener('submit',async e=>{e.preventDefault();const btn=e.currentTarget.querySelector('button[type="submit"]');btn.disabled=true;try{const rating=Number(e.currentTarget['v4-rating'].value);const notes=e.currentTarget['v4-notes'].value.trim()||null;const {error}=await supabase.rpc('save_book_review',{p_book_id:book.id,p_rating:rating,p_notes:notes,p_source:'frontend'});if(error)throw error;await clearDataCache();modalRoot.innerHTML='';toast('Rating saved.');location.reload();}catch(err){toast(err.message||'Could not save rating',true);btn.disabled=false;}});
}

function openPageCount(book){const current=book.edition_page_count||book.total_pages||'';modal(`<h2>Edit page count</h2><p>Correct the total pages for your displayed edition. Reading progress percentages will use this value.</p><form id="v4-pages-form" class="form-stack"><div class="field"><label for="v4-pages">Total pages</label><input class="input rating-input" id="v4-pages" type="number" min="1" inputmode="numeric" value="${esc(current)}" required></div><div class="modal-actions"><button class="btn" type="button" data-v4-close>Cancel</button><button class="btn btn-primary" type="submit">Save pages</button></div></form>`);modalRoot.querySelector('#v4-pages-form')?.addEventListener('submit',async e=>{e.preventDefault();const btn=e.currentTarget.querySelector('button[type="submit"]');btn.disabled=true;try{const pages=Number(e.currentTarget['v4-pages'].value);const {error}=await supabase.rpc('set_book_page_count',{p_book_id:book.id,p_total_pages:pages,p_source:'frontend'});if(error)throw error;await clearDataCache();modalRoot.innerHTML='';toast('Page count updated.');location.reload();}catch(err){toast(err.message||'Could not update page count',true);btn.disabled=false;}});}

async function openCoverPicker(book){modal(`<h2>Edit cover</h2><p>Loading available artwork for <strong>${esc(book.title)}</strong>…</p>`);try{const result=await fn('cover-options',{book_id:book.id});const candidates=result.candidates||[];modal(`<h2>Edit cover</h2><p>${book.ownership_status==='Owned'?'Exact-edition artwork is prioritised.':'Reference artwork is used until you own a specific edition.'} Your selection is saved permanently.</p><div class="cover-picker-grid">${candidates.map(c=>`<button class="cover-option ${c.selected?'selected':''}" data-v4-cover-option="${c.id}"><img src="${esc(c.source_url)}" alt="${esc(c.provider)} cover" loading="lazy" onerror="this.closest('button').style.display='none'"><span>${esc(c.provider)}${c.exact_edition?' · exact ISBN':''}</span></button>`).join('')||'<p>No cover options were returned.</p>'}</div><form id="v4-custom-cover" class="form-stack"><div class="field"><label for="v4-cover-url">Or use an image URL</label><input class="input" id="v4-cover-url" type="url" placeholder="https://…"></div><div class="modal-actions"><button class="btn" type="button" data-v4-close>Cancel</button><button class="btn btn-primary" type="submit">Use URL</button></div></form>`);modalRoot.querySelectorAll('[data-v4-cover-option]').forEach(btn=>btn.addEventListener('click',()=>chooseCover(book,btn.dataset.v4CoverOption,btn)));modalRoot.querySelector('#v4-custom-cover')?.addEventListener('submit',async e=>{e.preventDefault();const url=e.currentTarget['v4-cover-url'].value.trim();if(!url)return;const row={book_id:book.id,edition_id:book.display_edition_id||null,provider:'Manual URL',source_label:'Custom URL',source_url:url,exact_edition:book.ownership_status==='Owned'};const {data,error}=await supabase.from('book_cover_candidates').upsert(row,{onConflict:'book_id,source_url'}).select('id').single();if(error){toast(error.message,true);return;}await chooseCover(book,data.id,e.currentTarget.querySelector('button[type="submit"]'));});}catch(e){toast(e.message||'Could not load cover options',true);modalRoot.innerHTML='';}}
async function chooseCover(book,candidateId,button){button.disabled=true;try{await fn('select-cover',{book_id:book.id,candidate_id:candidateId,lock:true});await clearDataCache();modalRoot.innerHTML='';toast('Cover saved.');location.reload();}catch(e){toast(e.message||'Could not save cover',true);button.disabled=false;}}
async function refreshBookData(book){const btn=document.querySelector(`[data-v4-refresh-data="${book.id}"]`);if(btn){btn.disabled=true;btn.textContent='Refreshing…';}try{await fn('content-enrichment',{book_id:book.id,force:true});await clearDataCache();toast('Book data refreshed.');location.reload();}catch(e){toast(e.message||'Could not refresh book data',true);if(btn){btn.disabled=false;btn.textContent='Refresh book data';}}}

async function openProgressOnly(id){
 const {data:book,error}=await supabase.from('v_library').select('id,title,current_page,total_pages').eq('id',id).single();if(error||!book){toast('Could not load reading progress.',true);return;}
 modal(`<h2>Update progress</h2><p class="progress-book-name">${esc(book.title)}</p><form id="v4-progress-form" class="form-stack"><div class="field"><label for="v4-page">Current page</label><input class="input page-input" id="v4-page" type="number" min="0" ${book.total_pages?`max="${book.total_pages}"`:''} inputmode="numeric" value="${book.current_page??''}" autofocus required>${book.total_pages?`<small class="field-hint">${book.total_pages} pages in this edition</small>`:''}</div><div class="modal-actions"><button class="btn" type="button" data-v4-close>Cancel</button><button class="btn btn-primary" type="submit">Save progress</button></div></form>`);
 const input=modalRoot.querySelector('#v4-page');setTimeout(()=>input?.focus(),60);
 modalRoot.querySelector('#v4-progress-form')?.addEventListener('submit',async e=>{e.preventDefault();const btn=e.currentTarget.querySelector('button[type="submit"]');btn.disabled=true;try{const page=Number(e.currentTarget['v4-page'].value);const {error}=await supabase.rpc('update_reading_progress',{p_book_id:id,p_page:page,p_source:'frontend'});if(error)throw error;await clearDataCache();modalRoot.innerHTML='';toast('Progress updated.');location.reload();}catch(err){toast(err.message||'Could not update progress',true);btn.disabled=false;}});
}

function openAddByIsbn(){modal(`<h2>Add book by ISBN</h2><p>Use the ISBN from a physical copy for an exact owned edition, or add a specific edition to your wishlist.</p><form id="v4-add-isbn" class="form-stack"><div class="field"><label for="v4-isbn">ISBN-10 or ISBN-13</label><input class="input" id="v4-isbn" autocomplete="off" required></div><div class="field"><label for="v4-add-state">Add as</label><select class="input" id="v4-add-state"><option value="wishlist">Wishlist</option><option value="owned">Owned · unread</option></select></div><div class="modal-actions"><button class="btn" type="button" data-v4-close>Cancel</button><button class="btn btn-primary" type="submit">Add book</button></div></form>`);modalRoot.querySelector('#v4-add-isbn')?.addEventListener('submit',async e=>{e.preventDefault();const btn=e.currentTarget.querySelector('button[type="submit"]');btn.disabled=true;try{const isbn=e.currentTarget['v4-isbn'].value.trim();const owned=e.currentTarget['v4-add-state'].value==='owned';await fn('book-metadata',{isbn,owned,set_preferred:owned,overall_status:owned?'Owned - Unread':'Wishlist'});await clearDataCache();modalRoot.innerHTML='';toast('Book added.');location.reload();}catch(err){toast(err.message||'Could not add book',true);btn.disabled=false;}});}

function applyToolbar(){const toolbar=app?.querySelector('.toolbar');if(!toolbar||toolbar.dataset.v4Toolbar)return;toolbar.dataset.v4Toolbar='1';const b=document.createElement('button');b.className='btn btn-primary';b.type='button';b.textContent='Add by ISBN';b.addEventListener('click',openAddByIsbn);toolbar.prepend(b);}
function applyHeader(){const word=app?.querySelector('.wordmark span');if(word&&word.textContent!=='Library')word.textContent='Library';const old=app?.querySelector('#signout');if(old){const b=document.createElement('button');b.className='icon-btn';b.id='menu-toggle';b.setAttribute('aria-label','Menu');b.innerHTML='<span class="menu-bars"><i></i><i></i><i></i></span>';old.replaceWith(b);b.addEventListener('click',openSidebar);}}
function openSidebar(){const existing=document.querySelector('.sidebar-backdrop');if(existing){existing.remove();return;}const wrap=document.createElement('div');wrap.className='sidebar-backdrop';wrap.innerHTML=`<aside class="sidebar-panel"><div class="sidebar-head"><h2>Library</h2><button class="icon-btn" data-sidebar-close>×</button></div><section class="sidebar-section"><h3>Settings</h3><div class="setting-row"><span>Appearance</span><strong>Warm light</strong></div><div class="setting-row"><span>Cover art</span><strong>Exact editions preferred</strong></div><div class="setting-row"><span>Book data cache</span><strong>30 minutes</strong></div><div class="setting-row"><span>Cover cache</span><strong>Persistent</strong></div></section><section class="sidebar-section"><h3>Library tools</h3><div class="sidebar-actions"><button class="btn" data-sidebar-add>Add book by ISBN</button><button class="btn" data-sidebar-refresh>Refresh library data</button><button class="btn" data-sidebar-clear>Clear local cache</button></div></section><section class="sidebar-section"><div class="sidebar-actions"><button class="btn btn-danger" data-sidebar-logout>Log out</button></div></section></aside>`;document.body.append(wrap);wrap.addEventListener('click',e=>{if(e.target===wrap||e.target.closest('[data-sidebar-close]'))wrap.remove();});wrap.querySelector('[data-sidebar-add]')?.addEventListener('click',()=>{wrap.remove();openAddByIsbn();});wrap.querySelector('[data-sidebar-refresh]')?.addEventListener('click',async()=>{await clearDataCache();location.reload();});wrap.querySelector('[data-sidebar-clear]')?.addEventListener('click',async()=>{await clearDataCache();try{for(const key of await caches.keys())if(key.startsWith('librariangpt-')||key.startsWith('library-'))await caches.delete(key);}catch{}toast('Local cache cleared.');});wrap.querySelector('[data-sidebar-logout]')?.addEventListener('click',()=>supabase.auth.signOut());}
function applyNavCompact(){const nav=app?.querySelector('.bottom-nav');if(!nav)return;nav.classList.toggle('compact',window.scrollY>100);}
function applyAll(){applyHeader();applyToolbar();enhanceDetail();applyNavCompact();}

if(app){new MutationObserver(()=>requestAnimationFrame(applyAll)).observe(app,{childList:true,subtree:true});applyAll();}
window.addEventListener('scroll',()=>{const y=window.scrollY;if(Math.abs(y-lastScrollY)>4){applyNavCompact();lastScrollY=y;}},{passive:true});
document.addEventListener('click',e=>{const progress=e.target.closest('[data-progress]');if(progress){e.preventDefault();e.stopImmediatePropagation();openProgressOnly(progress.dataset.progress);return;}if(e.target.closest('#refresh')){e.preventDefault();e.stopImmediatePropagation();clearDataCache().finally(()=>location.reload());}},{capture:true});
