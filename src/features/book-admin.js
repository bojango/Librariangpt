import { supabase } from '../data/supabase.js';
import { toast } from '../ui/feedback.js';
import { buildLibraryPayload } from './book-admin-payload.js';
import { diagnostics } from '../diagnostics/diagnostics.js';
const modalRoot=document.querySelector('#modal-root');

const esc=(v='')=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const dateValue=v=>v?String(v).slice(0,10):'';
function closeModal(){modalRoot.innerHTML='';}
function option(v,label,current){return `<option value="${esc(v)}" ${String(v)===String(current??'')?'selected':''}>${esc(label)}</option>`;}
function editionLabel(e){return [e.owned?'Owned copy':e.is_reference?'Reference edition':'Edition',e.publisher,e.publication_year,e.format,e.isbn13||e.isbn10].filter(Boolean).join(' · ');}
function splitList(v){return String(v||'').split(',').map(x=>x.trim()).filter(Boolean);}

async function fetchBundle(id){
 const [bookQ,editionsQ,accoladesQ,bookAccoladesQ]=await Promise.all([
   supabase.from('v_library').select('*').eq('id',id).single(),
   supabase.from('editions').select('*').eq('book_id',id).order('owned',{ascending:false}).order('preferred_copy',{ascending:false}).order('publication_year',{ascending:false}),
   supabase.from('accolades').select('id,name,short_name,type,logo_url,logo_alt,official_url,logo_source_url,logo_source_name').order('name'),
   supabase.from('book_accolades').select('id,accolade_id,year,category,result,source_url,source_name,verified,sort_order,accolade:accolades(id,name,short_name,type,logo_url,logo_alt,official_url,logo_source_url,logo_source_name)').eq('book_id',id).order('sort_order',{ascending:true,nullsFirst:false}).order('year',{ascending:false,nullsFirst:false})
 ]);
 if(bookQ.error)throw bookQ.error;if(editionsQ.error)throw editionsQ.error;if(accoladesQ.error)throw accoladesQ.error;if(bookAccoladesQ.error)throw bookAccoladesQ.error;
 return {book:bookQ.data,editions:editionsQ.data||[],accolades:accoladesQ.data||[],bookAccolades:bookAccoladesQ.data||[]};
}

function accoladesFields(bundle){
 const rows=bundle.bookAccolades||[];
 return `<p class="admin-help">Only verified, source-backed recognitions appear on the book page. Use a specific book-level source; a general “award-winning author” claim is not enough.</p>
 <div class="admin-accolade-list">${rows.length?rows.map(row=>`<form class="admin-accolade-row" data-accolade-row="${esc(row.id)}"><strong>${esc(row.accolade?.name||'Recognition')}</strong><div class="admin-grid two"><label>Year<input name="year" type="number" min="0" max="3000" value="${esc(row.year??'')}"></label><label>Result<select name="result">${['Winner','Bestseller','Finalist','Shortlisted','Longlisted','Nominee','Recognition'].map(x=>option(x,x,row.result)).join('')}</select></label></div><label>Category<input name="category" value="${esc(row.category||'')}"></label><label>Source URL<input name="source_url" type="url" required value="${esc(row.source_url||'')}"></label><label>Source name<input name="source_name" value="${esc(row.source_name||'')}"></label><label>Display order<input name="sort_order" type="number" value="${esc(row.sort_order??'')}"></label><label class="admin-check"><input name="verified" type="checkbox" ${row.verified?'checked':''}> Verified for this book</label><div><button class="btn" type="submit">Save recognition</button><button class="text-action" type="button" data-delete-accolade="${esc(row.id)}">Remove</button></div></form>`).join(''):'<p class="admin-empty">No recognitions recorded.</p>'}</div>
 <form class="admin-accolade-add" data-accolade-add><h3>Add recognition</h3><label>Catalogue entry<select name="accolade_id"><option value="">Create a new catalogue entry</option>${bundle.accolades.map(a=>option(a.id,`${a.name} · ${a.type}`,null)).join('')}</select></label><div class="admin-new-accolade"><label>New accolade name<input name="name"></label><div class="admin-grid two"><label>Type<select name="type">${['Award','Prize','Bestseller','Recognition'].map(x=>option(x,x,'Recognition')).join('')}</select></label><label>Short mark<input name="short_name" maxlength="12"></label></div><label>Official URL<input name="official_url" type="url"></label><label>Logo URL (managed award storage)<input name="logo_url" type="url"></label><label>Logo alt text<input name="logo_alt"></label><label>Original logo source URL<input name="logo_source_url" type="url"></label><label>Logo source organisation<input name="logo_source_name"></label></div><div class="admin-grid two"><label>Year<input name="year" type="number" min="0" max="3000"></label><label>Result<select name="result">${['Winner','Bestseller','Finalist','Shortlisted','Longlisted','Nominee','Recognition'].map(x=>option(x,x,'Recognition')).join('')}</select></label></div><label>Category<input name="category"></label><label>Source URL<input name="source_url" type="url" required></label><label>Source name<input name="source_name"></label><label>Display order<input name="sort_order" type="number"></label><label class="admin-check"><input name="verified" type="checkbox"> Verified for display</label><button class="btn btn-primary" type="submit">Add recognition</button></form>`;
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
  </form>

   <details class="admin-section"><summary>Awards & recognition</summary><div class="admin-section-body">${accoladesFields(bundle)}</div></details>
   <section class="delete-book-v30"><div><p class="admin-kicker">Danger zone</p><h3>Delete book</h3><p>Permanently remove this book and its editions, progress, feedback, ratings and recommendation history.</p></div><button class="btn btn-danger" type="button" data-delete-book>Delete book</button><div class="delete-confirm-v30" data-delete-confirm hidden><p><strong>Delete “${esc(book.title)}”?</strong> This cannot be undone.</p><div><button class="btn" type="button" data-delete-cancel>Cancel</button><button class="btn btn-danger" type="button" data-delete-permanent>Delete permanently</button></div></div></section>
   <p class="book-admin-feedback" data-book-admin-feedback role="alert" hidden></p>
   <div class="book-admin-actions"><button type="button" class="btn" data-admin-close>Cancel</button><button type="button" class="btn btn-primary" data-book-admin-save>Save changes</button></div>
 </div></div>`;

 modalRoot.querySelectorAll('[data-admin-close]').forEach(b=>b.addEventListener('click',closeModal));
 modalRoot.querySelector('.book-admin-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('book-admin-backdrop'))closeModal();});
 const edSelect=modalRoot.querySelector('#admin-edition-select');
 if(edSelect)edSelect.addEventListener('change',()=>{const e=editions.find(x=>x.id===edSelect.value)||null;modalRoot.querySelector('#admin-edition-fields').innerHTML=editionFields(e);});
 const form=modalRoot.querySelector('#book-admin-form');
 const saveButton=modalRoot.querySelector('[data-book-admin-save]');
 let invalidShown=false;
 const onInvalid=e=>{if(invalidShown)return;invalidShown=true;showInvalidField(form,bundle,e.target);};
 form.addEventListener('invalid',onInvalid,true);
 form.addEventListener('input',()=>{invalidShown=false;});
 saveButton.addEventListener('click',()=>{invalidShown=false;attemptSave(form,bundle,saveButton,'button');});
 form.addEventListener('submit',e=>{e.preventDefault();invalidShown=false;attemptSave(form,bundle,saveButton,'form');});
 diagnostics.event('book_admin_opened',{book_id:book.id,overall_status_before:book.overall_status,ownership_status_before:book.ownership_status,edition_count:editions.length});
 modalRoot.querySelectorAll('[data-accolade-row]').forEach(form=>form.addEventListener('submit',event=>saveAccoladeRow(event,bundle.book.id)));
 modalRoot.querySelector('[data-accolade-add]')?.addEventListener('submit',event=>addAccolade(event,bundle.book.id));
 modalRoot.querySelectorAll('[data-delete-accolade]').forEach(button=>button.addEventListener('click',()=>deleteAccolade(button.dataset.deleteAccolade,bundle.book.id)));
 const confirm=modalRoot.querySelector('[data-delete-confirm]');
 modalRoot.querySelector('[data-delete-book]')?.addEventListener('click',e=>{e.currentTarget.hidden=true;confirm.hidden=false;});
 modalRoot.querySelector('[data-delete-cancel]')?.addEventListener('click',()=>{confirm.hidden=true;modalRoot.querySelector('[data-delete-book]').hidden=false;});
 modalRoot.querySelector('[data-delete-permanent]')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;try{const {error}=await supabase.rpc('delete_library_book',{p_book_id:book.id});if(error)throw error;closeModal();toast(`${book.title} deleted.`);location.hash='#/library';window.dispatchEvent(new CustomEvent('reading-room:refresh'));}catch(err){toast(err.message||'Could not delete book',true);e.currentTarget.disabled=false;}});
}

const nullableNumber=value=>String(value||'').trim()===''?null:Number(value);
async function reloadAccolades(bookId){closeModal();renderModal(await fetchBundle(bookId));}
async function saveAccoladeRow(event,bookId){event.preventDefault();const form=event.currentTarget;const fd=new FormData(form);const {error}=await supabase.from('book_accolades').update({year:nullableNumber(fd.get('year')),result:fd.get('result'),category:fd.get('category')||null,source_url:fd.get('source_url'),source_name:fd.get('source_name')||null,sort_order:nullableNumber(fd.get('sort_order')),verified:fd.get('verified')==='on'}).eq('id',form.dataset.accoladeRow);if(error){toast(error.message||'Could not save recognition',true);return;}toast('Recognition saved.');await reloadAccolades(bookId);window.dispatchEvent(new CustomEvent('reading-room:refresh'));}
async function deleteAccolade(id,bookId){if(!confirm('Remove this recognition from the book?'))return;const {error}=await supabase.from('book_accolades').delete().eq('id',id);if(error){toast(error.message||'Could not remove recognition',true);return;}toast('Recognition removed.');await reloadAccolades(bookId);window.dispatchEvent(new CustomEvent('reading-room:refresh'));}
async function addAccolade(event,bookId){event.preventDefault();const form=event.currentTarget;const fd=new FormData(form);let accoladeId=fd.get('accolade_id');try{if(!accoladeId){const name=String(fd.get('name')||'').trim();if(!name)throw new Error('Choose an existing accolade or enter a catalogue name.');const {data,error}=await supabase.from('accolades').upsert({name,type:fd.get('type'),short_name:fd.get('short_name')||null,official_url:fd.get('official_url')||null,logo_url:fd.get('logo_url')||null,logo_alt:fd.get('logo_alt')||null,logo_source_url:fd.get('logo_source_url')||null,logo_source_name:fd.get('logo_source_name')||null},{onConflict:'name'}).select('id').single();if(error)throw error;accoladeId=data.id;}const {error}=await supabase.from('book_accolades').insert({book_id:bookId,accolade_id:accoladeId,year:nullableNumber(fd.get('year')),result:fd.get('result'),category:fd.get('category')||null,source_url:fd.get('source_url'),source_name:fd.get('source_name')||null,sort_order:nullableNumber(fd.get('sort_order')),verified:fd.get('verified')==='on'});if(error)throw error;toast('Recognition added.');await reloadAccolades(bookId);window.dispatchEvent(new CustomEvent('reading-room:refresh'));}catch(error){toast(error.message||'Could not add recognition',true);}}

function statusContext(form,bundle){
 return {book_id:bundle.book.id,overall_status_before:bundle.book.overall_status,overall_status_after:form.elements.namedItem('overall_status')?.value||null,ownership_status_before:bundle.book.ownership_status,ownership_status_after:form.elements.namedItem('ownership_status')?.value||null};
}

function feedback(message){
 const node=modalRoot.querySelector('[data-book-admin-feedback]');
 if(node){node.textContent=message;node.hidden=!message;}
}

function showInvalidField(form,bundle,field){
 const section=field.closest('.admin-section');
 if(section) section.open=true;
 const name=field.name||field.id||'unknown';
 const label=field.closest('label')?.firstChild?.textContent?.trim()||'This field';
 feedback(`${label}: ${field.validationMessage||'Please check this value.'}`);
 diagnostics.event('book_admin_validation_failed',{...statusContext(form,bundle),form_valid:false,invalid_control_name:name});
 field.scrollIntoView?.({block:'center',behavior:'smooth'});
 field.focus?.({preventScroll:true});
}

function attemptSave(form,bundle,button,source){
 if(button.disabled)return;
 if(!form){feedback('Book settings could not be found. Please reopen and try again.');toast('Book settings could not be found. Please reopen and try again.',true);return;}
 const context=statusContext(form,bundle);
 const controlsValid=[...form.elements].every(field=>!field.willValidate||field.validity.valid);
 diagnostics.event('book_admin_save_tapped',{...context,source,form_valid:controlsValid});
 if(!form.checkValidity()){
  form.reportValidity();
  return;
 }
 feedback('');
 void saveForm(form,bundle,button,context);
}

async function saveForm(form,bundle,button,context){
 button.disabled=true;button.textContent='Saving…';
 const started=performance.now();
 diagnostics.event('book_admin_save_started',{...context,form_valid:true});
 try{
  const fd=new FormData(form);
  const selectedEditionId=modalRoot.querySelector('#admin-edition-select')?.value||fd.get('display_edition_id')||null;
  const signedRaw=fd.get('edition_signed');
  const library=buildLibraryPayload(fd,bundle.book);
  const book={title:fd.get('book_title'),subtitle:fd.get('book_subtitle'),authors:splitList(fd.get('book_authors')),fiction_nonfiction:fd.get('book_fiction_nonfiction'),primary_genre:fd.get('book_primary_genre'),original_publication_year:fd.get('book_original_publication_year'),language:fd.get('book_language'),series_name:fd.get('book_series_name'),series_order:fd.get('book_series_order'),themes_tags:splitList(fd.get('book_themes_tags')),synopsis:fd.get('book_synopsis'),notes:fd.get('book_notes')};
  const edition=selectedEditionId?{isbn13:fd.get('edition_isbn13'),isbn10:fd.get('edition_isbn10'),publisher:fd.get('edition_publisher'),imprint:fd.get('edition_imprint'),publication_year:fd.get('edition_publication_year'),publication_date:fd.get('edition_publication_date'),format:fd.get('edition_format'),binding:fd.get('edition_binding'),page_count:fd.get('edition_page_count'),country:fd.get('edition_country'),language:fd.get('edition_language'),condition:fd.get('edition_condition'),edition_statement:fd.get('edition_statement'),printing_impression:fd.get('edition_printing_impression'),number_line:fd.get('edition_number_line'),signed:signedRaw===''?null:signedRaw==='true',acquisition_date:fd.get('edition_acquisition_date'),acquisition_source:fd.get('edition_acquisition_source'),acquisition_price:fd.get('edition_acquisition_price'),currency:fd.get('edition_currency'),inscription:fd.get('edition_inscription'),notes:fd.get('edition_notes')} : {};
  diagnostics.event('book_admin_rpc_started',{...context});
  const {data,error}=await supabase.rpc('admin_edit_book',{p_book_id:bundle.book.id,p_library:library,p_book:book,p_edition_id:selectedEditionId||null,p_edition:edition});
  if(error)throw error;
  diagnostics.event('book_admin_rpc_succeeded',{...context,overall_status_after:data?.book?.overall_status||context.overall_status_after,ownership_status_after:data?.book?.ownership_status||context.ownership_status_after,duration_ms:Math.round(performance.now()-started)});
  closeModal();toast('Book details saved.');window.dispatchEvent(new CustomEvent('reading-room:refresh'));
 }catch(err){diagnostics.event('book_admin_rpc_failed',{...context,duration_ms:Math.round(performance.now()-started),error_name:err?.name||'Error'});const message=err.message||'Could not save book details';feedback(message);toast(message,true);button.disabled=false;button.textContent='Save changes';}
}

export async function openBookAdmin(id){try{const bundle=await fetchBundle(id);renderModal(bundle);}catch(err){toast(err.message||'Could not load book settings',true);}}
