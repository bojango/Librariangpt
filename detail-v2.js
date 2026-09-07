import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastNode = document.querySelector('#toast');
let rendering = false;

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const fmtDate = value => value ? new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(new Date(value)) : 'Not recorded';
const fmtCount = value => value == null ? '' : new Intl.NumberFormat('en-GB',{notation:Number(value)>=100000?'compact':'standard',maximumFractionDigits:1}).format(Number(value));
const fmtRating = value => value == null ? '—' : Number(value).toFixed(2);

function toast(message, error=false){
  if(!toastNode)return;
  toastNode.textContent=message;
  toastNode.className=`toast show${error?' error':''}`;
  clearTimeout(toastNode._detailTimer);
  toastNode._detailTimer=setTimeout(()=>toastNode.className='toast',3800);
}

function providerCode(provider=''){
  const p=provider.toLowerCase();
  if(p.includes('goodreads')) return 'GR';
  if(p.includes('google')) return 'GB';
  if(p.includes('open library')) return 'OL';
  return provider.slice(0,2).toUpperCase() || '★';
}

function ratingCard(rating){
  const label=esc(rating.provider||'Public');
  const count=rating.rating_count!=null ? `${fmtCount(rating.rating_count)} ratings` : 'Public score';
  const content=`<span class="rating-logo">${esc(providerCode(rating.provider))}</span><span class="rating-copy"><strong>${fmtRating(rating.rating_5)}<small>/5</small></strong><span>${label} · ${count}</span></span>`;
  return rating.source_url ? `<a class="rating-card" href="${esc(rating.source_url)}" target="_blank" rel="noreferrer">${content}</a>` : `<div class="rating-card">${content}</div>`;
}

function userRatingCard(book){
  if(book.overall_status!=='Read' && book.user_rating_5==null) return '';
  return `<button class="rating-card rating-user" type="button" data-edit-review="${book.id}">
    <span class="rating-logo">YOU</span><span class="rating-copy"><strong>${fmtRating(book.user_rating_5)}<small>/5</small></strong><span>Your rating · tap to edit</span></span>
  </button>`;
}

function metadataRows(book){
  const rows=[
    ['ISBN',book.isbn13||book.isbn10],
    ['Publisher',[book.publisher,book.imprint].filter(Boolean).join(' · ')],
    ['Edition',[book.edition_year,book.edition_format].filter(Boolean).join(' · ')],
    ['Edition statement',book.edition_statement],
    ['Printing / impression',book.printing_impression],
    ['Printer code / number line',book.number_line],
    ['Pages',book.edition_page_count||book.total_pages],
    ['Original publication',book.original_publication_year],
    ['Language',book.language],
    ['Country',book.country],
    ['Series',book.series ? `${book.series}${book.series_order?` #${book.series_order}`:''}` : null],
    ['Signed',book.signed===true?'Yes':book.signed===false?'No':null],
    ['Condition',book.condition],
    ['Dimensions',book.physical_dimensions],
    ['Metadata source',book.edition_metadata_source]
  ].filter(([,v])=>v!==null&&v!==undefined&&String(v).trim()!=='');
  return rows.map(([k,v])=>`<div class="metadata-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');
}

async function resolveBook(detail){
  const title=detail.querySelector('.detail-copy h1')?.textContent?.trim();
  const author=detail.querySelector('.hero-author')?.textContent?.trim();
  if(!title)return null;
  const {data,error}=await supabase.from('v_library').select('*').eq('title',title);
  if(error||!data?.length)return null;
  const a=String(author||'').toLowerCase();
  return data.find(x=>String(x.authors||'').toLowerCase()===a)||data[0];
}

async function loadExtras(bookId){
  const [ratings,rec]=await Promise.all([
    supabase.from('public_ratings').select('provider,rating_5,rating_count,review_count,source_url,is_primary,fetched_at').eq('book_id',bookId).order('is_primary',{ascending:false}).order('fetched_at',{ascending:false}),
    supabase.from('recommendations').select('why_recommended,match_score_10,outcome,recommendation_strength').eq('book_id',bookId).order('date_recommended',{ascending:false}).limit(1).maybeSingle()
  ]);
  return {ratings:ratings.data||[],rec:rec.data||null};
}

function renderDetail(detail,book,ratings,rec){
  const copy=detail.querySelector('.detail-copy');
  if(!copy)return;
  const progress=copy.querySelector('.progress-block');
  const actions=copy.querySelector('.detail-actions');
  if(progress)progress.remove();
  if(actions)actions.remove();

  const tags=[book.overall_status,book.ownership_status,book.primary_genre,book.edition_format].filter(Boolean);
  const ratingHtml=[...ratings.map(ratingCard),userRatingCard(book)].join('');
  const synopsis=book.synopsis || 'Synopsis is being sourced for this title.';
  const hasRead=book.overall_status==='Read';

  copy.innerHTML=`
    <p class="eyebrow">${esc(book.fiction_nonfiction||'Book')}</p>
    <h1>${esc(book.title)}</h1>
    <div class="hero-author">${esc(book.authors||'Unknown author')}</div>
    <div class="meta">${tags.map(t=>`<span class="badge">${esc(t)}</span>`).join('')}${rec?.match_score_10!=null?`<span class="badge accent">Predicted fit ${Number(rec.match_score_10).toFixed(1)}/10</span>`:''}</div>
    <div class="rating-strip">${ratingHtml || '<div class="rating-empty">No public rating available yet.</div>'}</div>
    <section class="book-synopsis"><h2>Synopsis</h2><p>${esc(synopsis)}</p></section>
    <div class="reading-slot"></div>
    <div class="actions-slot"></div>
    ${hasRead?`<section class="review-panel"><div><p class="eyebrow">Your review</p><h2>${book.user_rating_5!=null?`${fmtRating(book.user_rating_5)} / 5`:'Not rated yet'}</h2>${book.review_notes?`<p>${esc(book.review_notes)}</p>`:'<p>Add notes about what worked, what did not, pacing, structure, characters, setting or anything else worth teaching the recommendation model.</p>'}</div><button class="btn" data-edit-review="${book.id}">${book.user_rating_5!=null||book.review_notes?'Edit review':'Add review'}</button></section>`:''}
    <div class="reading-dates"><div><small>Started</small><strong>${fmtDate(book.started_at)}</strong></div><div><small>Finished</small><strong>${fmtDate(book.completed_at)}</strong></div>${book.total_pages?`<div><small>Length</small><strong>${esc(book.total_pages)} pages</strong></div>`:''}</div>
    ${rec?.why_recommended?`<section class="recommendation-panel"><p class="eyebrow">Librarian note</p><h2>Why it was recommended</h2><p>${esc(rec.why_recommended)}</p>${rec.outcome?`<span class="badge">Prediction: ${esc(rec.outcome)}</span>`:''}</section>`:''}
    <details class="metadata-accordion"><summary><span><strong>Book & edition details</strong><small>ISBN, publisher, printing, format and source data</small></span><span class="accordion-plus">+</span></summary><div class="metadata-list">${metadataRows(book)}</div></details>
  `;

  if(progress)copy.querySelector('.reading-slot')?.append(progress);
  if(actions)copy.querySelector('.actions-slot')?.append(actions);
  copy.querySelector('.reading-slot')?.classList.toggle('empty',!progress);
  copy.querySelector('.actions-slot')?.classList.toggle('empty',!actions);
}

async function maybeEnrich(book){
  if(book.synopsis && book.public_rating_provider)return false;
  const key=`librariangpt-content-${book.id}`;
  if(sessionStorage.getItem(key))return false;
  sessionStorage.setItem(key,'1');
  try{
    const {data,error}=await supabase.functions.invoke('content-enrichment',{body:{book_id:book.id}});
    if(error||data?.error)return false;
    return true;
  }catch{return false;}
}

async function enhanceDetail(){
  if(rendering||!app)return;
  const detail=app.querySelector('.detail-header');
  if(!detail||detail.dataset.detailV2==='loading')return;
  rendering=true;
  detail.dataset.detailV2='loading';
  try{
    let book=await resolveBook(detail);
    if(!book){delete detail.dataset.detailV2;return;}
    let extras=await loadExtras(book.id);
    renderDetail(detail,book,extras.ratings,extras.rec);
    detail.dataset.detailV2='true';
    if(await maybeEnrich(book)){
      const fresh=await supabase.from('v_library').select('*').eq('id',book.id).single();
      if(!fresh.error&&fresh.data){book=fresh.data;extras=await loadExtras(book.id);renderDetail(detail,book,extras.ratings,extras.rec);}
    }
  }finally{rendering=false;}
}

function openReview(book){
  modalRoot.innerHTML=`<div class="modal-backdrop"><div class="modal"><h2>${book.user_rating_5!=null?'Edit':'Add'} your review</h2><p>Your notes are stored as reading feedback and become evidence for future recommendations.</p><form id="precise-review-form" class="form-stack"><div class="field"><label for="precise-rating">Rating / 5</label><input class="input" id="precise-rating" type="number" min="0" max="5" step="0.01" inputmode="decimal" value="${book.user_rating_5??''}" placeholder="4.25" required></div><div class="field"><label for="precise-notes">Review notes</label><textarea class="input" id="precise-notes" rows="7" placeholder="What worked? What dragged? What would you want more or less of next time?">${esc(book.review_notes||book.user_review||'')}</textarea></div><div class="modal-actions"><button class="btn btn-quiet" type="button" data-review-close>Cancel</button><button class="btn btn-primary" type="submit">Save review</button></div></form></div></div>`;
  modalRoot.querySelector('[data-review-close]')?.addEventListener('click',()=>modalRoot.innerHTML='');
  modalRoot.querySelector('.modal-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))modalRoot.innerHTML=''});
  modalRoot.querySelector('#precise-review-form')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const btn=e.currentTarget.querySelector('button[type="submit"]');
    const rating=Number(e.currentTarget['precise-rating'].value);
    const notes=e.currentTarget['precise-notes'].value.trim()||null;
    btn.disabled=true;btn.textContent='Saving…';
    const {error}=await supabase.rpc('save_book_review',{p_book_id:book.id,p_rating:rating,p_notes:notes,p_source:'frontend'});
    if(error){toast(error.message||'Could not save review',true);btn.disabled=false;btn.textContent='Save review';return;}
    modalRoot.innerHTML='';toast('Review saved.');setTimeout(()=>location.reload(),500);
  });
}

async function reviewFromButton(button){
  const id=button.dataset.editReview;if(!id)return;
  const {data,error}=await supabase.from('v_library').select('*').eq('id',id).single();
  if(!error&&data)openReview(data);
}

document.addEventListener('click',e=>{
  const b=e.target.closest('[data-edit-review]');
  if(b){e.preventDefault();reviewFromButton(b);}
});

// Existing finish modal: upgrade rating precision and wording without replacing its reading workflow.
if(modalRoot){
  new MutationObserver(()=>{
    const rating=modalRoot.querySelector('#finish-form #rating');
    if(rating){rating.step='0.01';rating.inputMode='decimal';}
    const review=modalRoot.querySelector('#finish-form #review');
    if(review){review.placeholder='Optional review notes. These feed into future recommendations.';const label=review.closest('.field')?.querySelector('label');if(label)label.textContent='Review notes';}
  }).observe(modalRoot,{childList:true,subtree:true});
}

if(app){new MutationObserver(()=>setTimeout(enhanceDetail,30)).observe(app,{childList:true,subtree:true});enhanceDetail();}
