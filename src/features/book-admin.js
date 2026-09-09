import { supabase } from '../data/supabase.js';
import { toast } from '../ui/feedback.js';
const modalRoot=document.querySelector('#modal-root');

const esc=(v='')=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const dateValue=v=>v?String(v).slice(0,10):'';
function closeModal(){modalRoot.innerHTML='';}
function option(v,label,current){return `<option value="${esc(v)}" ${String(v)===String(current??'')?'selected':''}>${esc(label)}</option>`;}
function editionLabel(e){return [e.owned?'Owned copy':e.is_reference?'Reference edition':'Edition',e.publisher,e.publication_year,e.format,e.isbn13||e.isbn10].filter(Boolean).join(' · ');}
function splitList(v){return String(v||'').split(',').map(x=>x.trim()).filter(Boolean);}

async function fetchBundle(id){
 const [bookQ,editionsQ]=await Promise.all([
   supabase.from('v_library').select('*').eq('id',id).single(),
   supabase.from('editions').select('*').eq('book_id',id).order('owned',{ascending:false}).order('preferred_copy',{ascending:false}).order('publication_year',{ascending:false})
 ]);
 if(bookQ.error)throw bookQ.error;if(editionsQ.error)throw editionsQ.error;
 return {book:bookQ.data,editions:editionsQ.data||[]};
}

function editionFields(e){
 if(!e)return `<p class="admin-empty">No edition record exists yet. Use the exact-ISBN tools on the book page when you have a physical/reference edition to attach.</p>`;
 return `<div class="admin-edition-badges"><span>${e.owned?'Owned copy':e.is_reference?'Reference edition':'Edition'}</span>${e.preferred_copy?'<span>Preferred</span>':''}${e.cover_locked?'<span>Cover locked</span>':''}</div>
 <div class="admin-grid two">
  <label>ISBN-13<input name="edition_isbn13" inputmode="numeric" value="${esc(e.isbn13||'')}"></label>
  <label>ISBN-10<input name="edition_isbn10" value="${esc(e.isbn10||'')}"></label>
  <label>Publisher<input name="edition_publisher" value="${esc(e.publisher||'')}"></label>
  <label>Imprint<input name="edition_imprint" value="${esc(e.imprint||'')}"></label>
  <label>Publication year<input name="edition_publication_year" type="number" min="0" max="3000" value="${esc(e.publication_year||'')}"></label>
  <label>Publication date<input name="edition_publication_date" type="date" value="${esc(dateValue(e.publication_date))}"></label>
  <label>Format<input name="edition_format" value="${esc(e.format||'')}"></label>
  <label>Binding<input name="edition_binding" value="${esc(e.binding||'')}"></label>
  <label>Pages<input name="edition_page_count" type="number" min="1" inputmode="numeric" value="${esc(e.page_count||'')}"></label>
  <label>Country<input name="edition_country" value="${esc(e.country||'')}"></label>
  <label>Language<input name="edition_language" value="${esc(e.language||'')}"></label>
  <label>Condition<input name="edition_condition" value="${esc(e.condition||'')}"></label>
 </div>
 <label>Edition statement<input name="edition_statement" value="${esc(e.edition_statement||'')}"></label>
 <div class="admin-grid two">
  <label>Printing / impression<input name="edition_printing_impression" value="${esc(e.printing_impression||'')}"></label>
  <label>Number line / printer code<input name="edition_number_line" value="${esc(e.number_line||'')}"></label>
 </div>
 <div class="admin-grid two">
  <label>Signed<select name="edition_signed"><option value="" ${e.signed==null?'selected':''}>Unknown / not recorded</option><option value="true" ${e.signed===true?'selected':''}>Yes</option><option value="false" ${e.signed===false?'selected':''}>No</option></select></label>
  <label>Acquired<input name="edition_acquisition_date" type="date" value="${esc(dateValue(e.acquisition_date))}"></label>
  <label>Acquired from<input name="edition_acquisition_source" value="${esc(e.acquisition_source||'')}"></label>
  <label>Price paid<input name="edition_acquisition_price" type="number" step="0.01" min="0" inputmode="decimal" value="${esc(e.acquisition_price||'')}"></label>
  <label>Currency<input name="edition_currency" maxlength="3" value="${esc(e.currency||'')}"></label>
 </div>
 <label>Inscription<textarea name="edition_inscription" rows="2">${esc(e.inscription||'')}</textarea></label>
 <label>Edition notes<textarea name="edition_notes" rows="3">${esc(e.notes||'')}</textarea></label>`;
}

function renderModal(bundle){
 const {book,editions}=bundle;
 const selectedId=book.display_edition_id||editions[0]?.id||'';
 const selected=editions.find(e=>e.id===selectedId)||editions[0]||null;
 const statuses=['Recommended','Wishlist','Owned - Unread','Currently Reading','Read','Paused','DNF','Not Interested'];
 const ownership=['Not Owned','Owned','On Order','Borrowed','Unknown'];
 const priorities=['','High','Medium','Low','Someday'];
 modalRoot.innerHTML=`<div class="modal-backdrop book-admin-backdrop"><div class="modal book-admin-modal">
  <div class="book-admin-head"><div><p class="admin-kicker">Library administration</p><h2>Edit ${esc(book.title)}</h2><p>Changes here update the canonical Supabase record, reading history and recommendation status together.</p></div><button type="button" class="admin-close" data-admin-close aria-label="Close">×</button></div>
  <form id="book-admin-form">
   <details class="admin-section" open><summary>Collection & reading</summary><div class="admin-section-body">
    <div class="admin-grid two">
     <label>Library status<select name="overall_status">${statuses.map(x=>option(x,x,book.overall_status)).join('')}</select></label>
     <label>Ownership<select name="ownership_status">${ownership.map(x=>option(x,x,book.ownership_status)).join('')}</select></label>
     <label>Reading priority<select name="reading_priority">${priorities.map(x=>option(x,x||'Not set',book.reading_priority||'')).join('')}</select></label>
     <label>Current page<input name="current_page" type="number" min="0" inputmode="numeric" value="${esc(book.current_page??'')}"></label>
     <label>Started reading<input name="started_date" type="date" value="${esc(dateValue(book.started_at))}"></label>
     <label>Finished reading<input name="completed_date" type="date" value="${esc(dateValue(book.completed_at))}"></label>
    </div>
    <label>Displayed edition<select name="display_edition_id"><option value="">No edition selected</option>${editions.map(e=>option(e.id,editionLabel(e),selectedId)).join('')}</select></label>
    <p class="admin-help">Marking a title Owned does not claim the current reference edition is your exact copy. Attach the physical ISBN separately when you know it.</p>
   </div></details>

   <details class="admin-section"><summary>Book metadata</summary><div class="admin-section-body">
    <div class="admin-grid two">
     <label>Title<input name="book_title" value="${esc(book.title||'')}"></label>
     <label>Subtitle<input name="book_subtitle" value="${esc(book.subtitle||'')}"></label>
     <label>Author(s)<input name="book_authors" value="${esc(book.authors||'')}"><small>Comma-separate multiple authors.</small></label>
     <label>Fiction / nonfiction<select name="book_fiction_nonfiction"><option value="">Not recorded</option>${['Fiction','Nonfiction'].map(x=>option(x,x,book.fiction_nonfiction)).join('')}</select></label>
     <label>Primary genre<input name="book_primary_genre" value="${esc(book.primary_genre||'')}"></label>
     <label>Original publication year<input name="book_original_publication_year" type="number" min="0" max="3000" value="${esc(book.original_publication_year||'')}"></label>
     <label>Language<input name="book_language" value="${esc(book.language||'')}"></label>
     <label>Series<input name="book_series_name" value="${esc(book.series||'')}"></label>
     <label>Series order<input name="book_series_order" type="number" step="0.01" value="${esc(book.series_order||'')}"></label>
     <label>Tags<input name="book_themes_tags" value="${esc(Array.isArray(book.themes_tags)?book.themes_tags.join(', '):(book.themes_tags||''))}"><small>Comma-separated.</small></label>
    </div>
    <label>Synopsis<textarea name="book_synopsis" rows="6">${esc(book.synopsis||'')}</textarea></label>
    <label>Book notes<textarea name="book_notes" rows="4">${esc(book.notes||'')}</textarea></label>
   </div></details>

   <details class="admin-section"><summary>Edition details</summary><div class="admin-section-body">
    ${editions.length>1?`<label>Edition to edit<select id="admin-edition-select">${editions.map(e=>option(e.id,editionLabel(e),selected?.id)).join('')}</select></label>`:''}
    <div id="admin-edition-fields">${editionFields(selected)}</div>
   </div></details>

   <section class="delete-book-v30"><div><p class="admin-kicker">Danger zone</p><h3>Delete book</h3><p>Permanently remove this book and its editions, progress, feedback, ratings and recommendation history.</p></div><button class="btn btn-danger" type="button" data-delete-book>Delete book</button><div class="delete-confirm-v30" data-delete-confirm hidden><p><strong>Delete “${esc(book.title)}”?</strong> This cannot be undone.</p><div><button class="btn" type="button" data-delete-cancel>Cancel</button><button class="btn btn-danger" type="button" data-delete-permanent>Delete permanently</button></div></div></section>
   <div class="book-admin-actions"><button type="button" class="btn" data-admin-close>Cancel</button><button type="submit" class="btn btn-primary">Save changes</button></div>
  </form>
 </div></div>`;

 modalRoot.querySelectorAll('[data-admin-close]').forEach(b=>b.addEventListener('click',closeModal));
 modalRoot.querySelector('.book-admin-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('book-admin-backdrop'))closeModal();});
 const edSelect=modalRoot.querySelector('#admin-edition-select');
 if(edSelect)edSelect.addEventListener('change',()=>{const e=editions.find(x=>x.id===edSelect.value)||null;modalRoot.querySelector('#admin-edition-fields').innerHTML=editionFields(e);});
 modalRoot.querySelector('#book-admin-form')?.addEventListener('submit',e=>saveForm(e,bundle));
 const confirm=modalRoot.querySelector('[data-delete-confirm]');
 modalRoot.querySelector('[data-delete-book]')?.addEventListener('click',e=>{e.currentTarget.hidden=true;confirm.hidden=false;});
 modalRoot.querySelector('[data-delete-cancel]')?.addEventListener('click',()=>{confirm.hidden=true;modalRoot.querySelector('[data-delete-book]').hidden=false;});
 modalRoot.querySelector('[data-delete-permanent]')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;try{const {error}=await supabase.rpc('delete_library_book',{p_book_id:book.id});if(error)throw error;closeModal();toast(`${book.title} deleted.`);location.hash='#/library';window.dispatchEvent(new CustomEvent('reading-room:refresh'));}catch(err){toast(err.message||'Could not delete book',true);e.currentTarget.disabled=false;}});
}

async function saveForm(event,bundle){
 event.preventDefault();const form=event.currentTarget;const submit=form.querySelector('button[type="submit"]');submit.disabled=true;submit.textContent='Saving…';
 try{
  const fd=new FormData(form);
  const selectedEditionId=modalRoot.querySelector('#admin-edition-select')?.value||fd.get('display_edition_id')||null;
  const signedRaw=fd.get('edition_signed');
  const library={overall_status:fd.get('overall_status'),ownership_status:fd.get('ownership_status'),reading_priority:fd.get('reading_priority'),started_date:fd.get('started_date'),completed_date:fd.get('completed_date'),current_page:fd.get('current_page'),display_edition_id:fd.get('display_edition_id')};
  const book={title:fd.get('book_title'),subtitle:fd.get('book_subtitle'),authors:splitList(fd.get('book_authors')),fiction_nonfiction:fd.get('book_fiction_nonfiction'),primary_genre:fd.get('book_primary_genre'),original_publication_year:fd.get('book_original_publication_year'),language:fd.get('book_language'),series_name:fd.get('book_series_name'),series_order:fd.get('book_series_order'),themes_tags:splitList(fd.get('book_themes_tags')),synopsis:fd.get('book_synopsis'),notes:fd.get('book_notes')};
  const edition=selectedEditionId?{isbn13:fd.get('edition_isbn13'),isbn10:fd.get('edition_isbn10'),publisher:fd.get('edition_publisher'),imprint:fd.get('edition_imprint'),publication_year:fd.get('edition_publication_year'),publication_date:fd.get('edition_publication_date'),format:fd.get('edition_format'),binding:fd.get('edition_binding'),page_count:fd.get('edition_page_count'),country:fd.get('edition_country'),language:fd.get('edition_language'),condition:fd.get('edition_condition'),edition_statement:fd.get('edition_statement'),printing_impression:fd.get('edition_printing_impression'),number_line:fd.get('edition_number_line'),signed:signedRaw===''?null:signedRaw==='true',acquisition_date:fd.get('edition_acquisition_date'),acquisition_source:fd.get('edition_acquisition_source'),acquisition_price:fd.get('edition_acquisition_price'),currency:fd.get('edition_currency'),inscription:fd.get('edition_inscription'),notes:fd.get('edition_notes')} : {};
  const {data,error}=await supabase.rpc('admin_edit_book',{p_book_id:bundle.book.id,p_library:library,p_book:book,p_edition_id:selectedEditionId||null,p_edition:edition});
  if(error)throw error;
  closeModal();toast('Book details saved.');window.dispatchEvent(new CustomEvent('reading-room:refresh'));
 }catch(err){toast(err.message||'Could not save book details',true);submit.disabled=false;submit.textContent='Save changes';}
}

export async function openBookAdmin(id){try{const bundle=await fetchBundle(id);renderModal(bundle);}catch(err){toast(err.message||'Could not load book settings',true);}}
