import { supabase } from '../data/supabase.js';
import { toast } from '../ui/feedback.js';
const modalRoot=document.querySelector('#modal-root');
let tesseractPromise=null;

const esc=(v='')=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
const cleanText=(v='')=>String(v).replace(/\r/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
function closeModal(){if(modalRoot)modalRoot.innerHTML='';}
function pageLabel(q){if(q.page_start&&q.page_end&&q.page_end!==q.page_start)return `pp. ${q.page_start}–${q.page_end}`;if(q.page_start)return `p. ${q.page_start}`;return'';}
function defaultChapter(){return app?.querySelector('.detail-header[data-library-detail="ready"] .chapter-progress-line')?.textContent?.trim()||'';}

async function loadTesseract(){
 if(window.Tesseract)return window.Tesseract;
 if(tesseractPromise)return tesseractPromise;
 tesseractPromise=new Promise((resolve,reject)=>{
   const existing=document.querySelector('script[data-reading-room-ocr]');
   if(existing){existing.addEventListener('load',()=>window.Tesseract?resolve(window.Tesseract):reject(new Error('OCR failed to load')),{once:true});existing.addEventListener('error',()=>reject(new Error('OCR failed to load')),{once:true});return;}
   const script=document.createElement('script');script.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';script.async=true;script.crossOrigin='anonymous';script.dataset.readingRoomOcr='1';script.onload=()=>window.Tesseract?resolve(window.Tesseract):reject(new Error('OCR failed to load'));script.onerror=()=>reject(new Error('OCR failed to load'));document.head.appendChild(script);
 }).catch(err=>{tesseractPromise=null;throw err;});
 return tesseractPromise;
}

async function canvasFromFile(file){
 const url=URL.createObjectURL(file);
 try{
   const image=new Image();image.decoding='async';image.src=url;await image.decode();
   const maxW=1700,maxH=2300;const scale=Math.min(1,maxW/image.naturalWidth,maxH/image.naturalHeight);
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);if('filter' in ctx)ctx.filter='grayscale(1) contrast(1.16)';ctx.drawImage(image,0,0,canvas.width,canvas.height);ctx.filter='none';return canvas;
 } finally {URL.revokeObjectURL(url);}
}

function loadingModal(book){
 modalRoot.innerHTML=`<div class="modal-backdrop quote-modal-backdrop-v40"><div class="modal quote-modal-v40"><div class="quote-ocr-loading-v40"><p class="eyebrow">Scanning locally</p><h2>Reading the page</h2><p id="quote-ocr-status-v40">Preparing image…</p><div class="quote-ocr-track-v40"><span id="quote-ocr-progress-v40"></span></div><small>The image stays on this device and is discarded after text extraction. The first scan may take longer while the OCR engine loads.</small><button class="btn" type="button" data-quote-cancel>Cancel</button></div></div></div>`;
 modalRoot.querySelector('[data-quote-cancel]')?.addEventListener('click',closeModal);
}
function setOcrProgress(message,pct=null){const status=modalRoot?.querySelector('#quote-ocr-status-v40');const bar=modalRoot?.querySelector('#quote-ocr-progress-v40');if(status&&message)status.textContent=message;if(bar&&pct!=null)bar.style.width=`${Math.max(2,Math.min(100,pct))}%`;}

async function scanPage(book){
 const input=document.createElement('input');input.type='file';input.accept='image/*';input.style.display='none';document.body.appendChild(input);
 input.addEventListener('change',async()=>{
   const file=input.files?.[0];input.remove();if(!file)return;
   loadingModal(book);
   let worker=null,canvas=null;
   try{
     canvas=await canvasFromFile(file);setOcrProgress('Loading text recognition…',8);
     const Tesseract=await loadTesseract();
     worker=await Tesseract.createWorker('eng',1,{logger:m=>{
       if(!modalRoot?.querySelector('#quote-ocr-status-v40'))return;
       const label=String(m.status||'Reading page…').replace(/\b\w/g,c=>c.toUpperCase());
       const pct=typeof m.progress==='number'?10+(m.progress*88):null;setOcrProgress(label,pct);
     }});
     const result=await worker.recognize(canvas);const text=cleanText(result?.data?.text||'');
     await worker.terminate();worker=null;canvas.width=1;canvas.height=1;canvas=null;
     if(!text)throw new Error('No text could be read from that image. Try a flatter, sharper photo with the full page visible.');
     reviewScan(book,text);
   }catch(err){try{await worker?.terminate();}catch{}if(canvas){canvas.width=1;canvas.height=1;}closeModal();toast(err?.message||'Could not read that page',true);}
 },{once:true});
 input.click();
}

function quoteFields(book,{page_start=null,page_end=null,chapter='',quote_text='',note=''}={}){
 const defaultPage=page_start??(book.overall_status==='Currently Reading'?book.current_page:'');
 return `<div class="quote-location-grid-v40"><div class="field"><label for="quote-page-start-v40">Page</label><input class="input" id="quote-page-start-v40" type="number" min="1" inputmode="numeric" value="${esc(defaultPage??'')}"></div><div class="field"><label for="quote-page-end-v40">End page <small>optional</small></label><input class="input" id="quote-page-end-v40" type="number" min="1" inputmode="numeric" value="${esc(page_end??'')}"></div></div><div class="field"><label for="quote-chapter-v40">Chapter <small>optional</small></label><input class="input" id="quote-chapter-v40" type="text" value="${esc(chapter||defaultChapter())}" placeholder="e.g. Chapter X: Svalbard, Norway"></div><div class="field"><label for="quote-text-v40">Quote or passage</label><textarea class="input quote-textarea-v40" id="quote-text-v40" rows="5" required>${esc(quote_text)}</textarea></div><div class="field"><label for="quote-note-v40">Your note <small>optional</small></label><textarea class="input" id="quote-note-v40" rows="3" placeholder="Why did this stand out?">${esc(note||'')}</textarea></div>`;
}

function reviewScan(book,ocrText){
 modalRoot.innerHTML=`<div class="modal-backdrop quote-modal-backdrop-v40"><div class="modal quote-modal-v40"><div class="quote-modal-head-v40"><div><p class="eyebrow">Scan complete</p><h2>Save a passage</h2></div><button class="quote-close-v40" type="button" data-quote-close aria-label="Close">×</button></div><p class="quote-help-v40">Select the passage you want in the extracted page text, then tap <strong>Use selection</strong>. Correct any OCR mistakes before saving.</p><div class="field"><label for="quote-ocr-source-v40">Extracted page text</label><textarea class="input quote-ocr-source-v40" id="quote-ocr-source-v40" rows="8">${esc(ocrText)}</textarea><button class="quote-use-selection-v40" type="button" id="quote-use-selection-v40">Use selection</button></div><form id="quote-save-form-v40" class="form-stack">${quoteFields(book)}<div class="modal-actions"><button class="btn" type="button" data-quote-close>Cancel</button><button class="btn btn-primary" type="submit">Save quote</button></div></form></div></div>`;
 modalRoot.querySelectorAll('[data-quote-close]').forEach(x=>x.addEventListener('click',closeModal));
 const source=modalRoot.querySelector('#quote-ocr-source-v40'),target=modalRoot.querySelector('#quote-text-v40');
 modalRoot.querySelector('#quote-use-selection-v40')?.addEventListener('click',()=>{const start=source.selectionStart,end=source.selectionEnd;const selected=cleanText(source.value.slice(start,end));if(!selected){toast('Select the passage in the extracted text first.',true);source.focus();return;}target.value=selected;target.focus();});
 bindSaveForm(book,'scan');
}

function openManual(book,existing=null){
 const editing=Boolean(existing);
 modalRoot.innerHTML=`<div class="modal-backdrop quote-modal-backdrop-v40"><div class="modal quote-modal-v40"><div class="quote-modal-head-v40"><div><p class="eyebrow">${editing?'Edit passage':'Manual entry'}</p><h2>${editing?'Edit quote':'Save a quote'}</h2></div><button class="quote-close-v40" type="button" data-quote-close aria-label="Close">×</button></div><form id="quote-save-form-v40" class="form-stack">${quoteFields(book,existing||{})}<div class="modal-actions"><button class="btn" type="button" data-quote-close>Cancel</button><button class="btn btn-primary" type="submit">${editing?'Save changes':'Save quote'}</button></div></form></div></div>`;
 modalRoot.querySelectorAll('[data-quote-close]').forEach(x=>x.addEventListener('click',closeModal));bindSaveForm(book,existing?.capture_method||'manual',existing?.id||null);
}

async function latestSession(bookId){const {data}=await supabase.from('reading_sessions').select('id,edition_id,status,started_at').eq('book_id',bookId).order('started_at',{ascending:false,nullsFirst:false}).limit(1).maybeSingle();return data||null;}
function formValues(){const pageStart=modalRoot.querySelector('#quote-page-start-v40')?.value;const pageEnd=modalRoot.querySelector('#quote-page-end-v40')?.value;return{page_start:pageStart?Number(pageStart):null,page_end:pageEnd?Number(pageEnd):null,chapter:modalRoot.querySelector('#quote-chapter-v40')?.value.trim()||null,quote_text:cleanText(modalRoot.querySelector('#quote-text-v40')?.value||''),note:modalRoot.querySelector('#quote-note-v40')?.value.trim()||null};}
function bindSaveForm(book,captureMethod,quoteId=null){
 modalRoot.querySelector('#quote-save-form-v40')?.addEventListener('submit',async e=>{
   e.preventDefault();const button=e.currentTarget.querySelector('button[type="submit"]');button.disabled=true;button.textContent='Saving…';
   try{
     const values=formValues();if(!values.quote_text)throw new Error('Add the quote or passage before saving.');if(values.page_start&&values.page_end&&values.page_end<values.page_start)throw new Error('End page cannot be before the start page.');
     if(quoteId){const {error}=await supabase.from('book_quotes').update(values).eq('id',quoteId);if(error)throw error;}
     else {const session=await latestSession(book.id);const payload={...values,book_id:book.id,edition_id:session?.edition_id||book.current_edition_id||book.display_edition_id||book.reference_edition_id||null,session_id:session?.id||null,capture_method:captureMethod==='scan'?'scan':'manual'};const {error}=await supabase.from('book_quotes').insert(payload);if(error)throw error;}
     closeModal();toast(quoteId?'Quote updated.':'Quote saved.');window.dispatchEvent(new CustomEvent('reading-room:refresh'));
   }catch(err){toast(err?.message||'Could not save quote',true);button.disabled=false;button.textContent=quoteId?'Save changes':'Save quote';}
 });
}

function confirmDelete(book,quote){
 modalRoot.innerHTML=`<div class="modal-backdrop quote-modal-backdrop-v40"><div class="modal quote-confirm-v40"><h2>Delete this quote?</h2><p>This removes the saved passage and your note. It does not affect reading progress.</p><div class="modal-actions"><button class="btn" type="button" data-quote-close>Cancel</button><button class="btn btn-danger" type="button" id="quote-delete-confirm-v40">Delete</button></div></div></div>`;
 modalRoot.querySelector('[data-quote-close]')?.addEventListener('click',closeModal);modalRoot.querySelector('#quote-delete-confirm-v40')?.addEventListener('click',async e=>{e.currentTarget.disabled=true;const {error}=await supabase.from('book_quotes').delete().eq('id',quote.id);if(error){toast(error.message||'Could not delete quote',true);e.currentTarget.disabled=false;return;}closeModal();toast('Quote deleted.');window.dispatchEvent(new CustomEvent('reading-room:refresh'));});
}

export function handleQuoteAction(action, book, quote = null) {
 if(action==='scan')return scanPage(book);
 if(action==='add')return openManual(book);
 if(action==='edit'&&quote)return openManual(book,quote);
 if(action==='delete'&&quote)return confirmDelete(book,quote);
}
