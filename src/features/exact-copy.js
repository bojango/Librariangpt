import { supabase } from '../data/supabase.js';
import { toast } from '../ui/feedback.js';
const modalRoot=document.querySelector('#modal-root');

const esc=(v='')=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
function closeModal(){if(modalRoot)modalRoot.innerHTML='';}
async function clearCaches(){}
async function fetchBook(bookId){const {data,error}=await supabase.from('v_library').select('*').eq('id',bookId).single();if(error)throw error;return data;}

async function verifyCopy(book){
 const editionId=book.display_edition_id||book.current_edition_id;if(!editionId)return toast('Choose the edition you own first.',true);
 try{
  const {error}=await supabase.rpc('verify_owned_edition',{p_book_id:book.id,p_edition_id:editionId,p_source:'frontend'});if(error)throw error;
  await clearCaches();toast('Exact copy verified.');window.dispatchEvent(new CustomEvent('reading-room:refresh'));
 }catch(e){toast(e.message||'Could not verify this copy',true);}
}

async function confirmPages(book){
 const pages=Number(book.edition_page_count||book.total_pages||0);if(!pages)return;
 try{
  const {error}=await supabase.rpc('set_book_page_count',{p_book_id:book.id,p_total_pages:pages,p_source:'physical copy confirmation'});if(error)throw error;
  await clearCaches();toast(`${pages} pages confirmed for this copy.`);window.dispatchEvent(new CustomEvent('reading-room:refresh'));
 }catch(e){toast(e.message||'Could not confirm page count',true);}
}

function openPhotoSource(book){
 if(!modalRoot)return;
 modalRoot.innerHTML=`<div class="modal-backdrop copy-photo-backdrop"><section class="modal copy-photo-source" role="dialog" aria-modal="true">
   <h2>Use your own cover</h2>
   <p>For the cleanest result, place the book flat in even light and hold the camera roughly parallel to the cover. You’ll straighten the four corners before saving.</p>
   <div class="copy-photo-actions">
    <button class="btn btn-primary" type="button" data-cover-camera>Take photo</button>
    <button class="btn" type="button" data-cover-library>Choose photo</button>
    <button class="btn" type="button" data-cover-cancel>Cancel</button>
   </div>
   <input data-cover-camera-input type="file" accept="image/*" capture="environment" hidden>
   <input data-cover-library-input type="file" accept="image/*" hidden>
 </section></div>`;
 const cam=modalRoot.querySelector('[data-cover-camera-input]'),lib=modalRoot.querySelector('[data-cover-library-input]');
 modalRoot.querySelector('[data-cover-camera]')?.addEventListener('click',()=>cam.click());
 modalRoot.querySelector('[data-cover-library]')?.addEventListener('click',()=>lib.click());
 modalRoot.querySelector('[data-cover-cancel]')?.addEventListener('click',closeModal);
 modalRoot.querySelector('.copy-photo-backdrop')?.addEventListener('click',e=>{if(e.target.classList.contains('copy-photo-backdrop'))closeModal();});
 const changed=e=>{const file=e.target.files?.[0];if(file)openPhotoEditor(book,file);};cam.addEventListener('change',changed);lib.addEventListener('change',changed);
}

function openPhotoEditor(book,file){
 const url=URL.createObjectURL(file);
 modalRoot.innerHTML=`<div class="modal-backdrop copy-photo-backdrop"><section class="modal copy-photo-editor" role="dialog" aria-modal="true">
  <div class="copy-editor-head"><div><span class="exact-copy-eyebrow">Cover cleanup</span><h2>Straighten the cover</h2></div><button class="copy-editor-close" type="button" data-cover-cancel aria-label="Close">×</button></div>
  <p>Drag the four handles onto the four physical corners of the book cover. Library will remove the surrounding photo, correct the perspective and export a clean high-resolution cover.</p>
  <div class="cover-photo-stage" data-cover-stage>
    <img src="${esc(url)}" alt="Cover photograph" data-cover-image>
    <svg class="cover-photo-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polygon data-cover-polygon points="4,4 96,4 96,96 4,96"></polygon></svg>
    ${[0,1,2,3].map(i=>`<button class="cover-corner" type="button" data-cover-corner="${i}" aria-label="Cover corner ${i+1}"></button>`).join('')}
  </div>
  <label class="cover-cleanup-toggle"><input type="checkbox" data-cover-cleanup checked> Slightly normalise contrast and colour</label>
  <div class="modal-actions"><button class="btn" type="button" data-cover-cancel>Cancel</button><button class="btn btn-primary" type="button" data-cover-save>Save clean cover</button></div>
 </section></div>`;
 const img=modalRoot.querySelector('[data-cover-image]');const stage=modalRoot.querySelector('[data-cover-stage]');const poly=modalRoot.querySelector('[data-cover-polygon]');
 const pts=[{x:.04,y:.04},{x:.96,y:.04},{x:.96,y:.96},{x:.04,y:.96}];
 function drawPoints(){poly.setAttribute('points',pts.map(p=>`${p.x*100},${p.y*100}`).join(' '));modalRoot.querySelectorAll('[data-cover-corner]').forEach((h,i)=>{h.style.left=`${pts[i].x*100}%`;h.style.top=`${pts[i].y*100}%`;});}
 drawPoints();
 let active=-1;
 modalRoot.querySelectorAll('[data-cover-corner]').forEach(h=>h.addEventListener('pointerdown',e=>{active=Number(h.dataset.coverCorner);h.setPointerCapture?.(e.pointerId);e.preventDefault();}));
 stage.addEventListener('pointermove',e=>{if(active<0)return;const r=stage.getBoundingClientRect();pts[active].x=Math.min(.995,Math.max(.005,(e.clientX-r.left)/r.width));pts[active].y=Math.min(.995,Math.max(.005,(e.clientY-r.top)/r.height));drawPoints();e.preventDefault();});
 const end=()=>{active=-1;};stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);stage.addEventListener('pointerleave',e=>{if(e.buttons===0)end();});
 modalRoot.querySelectorAll('[data-cover-cancel]').forEach(b=>b.addEventListener('click',()=>{URL.revokeObjectURL(url);closeModal();}));
 modalRoot.querySelector('[data-cover-save]')?.addEventListener('click',async e=>{
  const btn=e.currentTarget;btn.disabled=true;btn.textContent='Processing…';
  try{
   const cleaned=modalRoot.querySelector('[data-cover-cleanup]').checked;
   const canvas=await rectifyCover(img,pts,cleaned);
   const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not create cover image')),'image/jpeg',.93));
   const dataUrl=await blobToDataUrl(blob);const base64=dataUrl.split(',')[1];
   const editionId=book.display_edition_id||book.current_edition_id||book.reference_edition_id;if(!editionId)throw new Error('Choose an edition before uploading a cover.');
   btn.textContent='Uploading…';
   const {data,error}=await supabase.functions.invoke('upload-cover-photo',{body:{book_id:book.id,edition_id:editionId,image_base64:base64,mime_type:'image/jpeg',width:canvas.width,height:canvas.height,processing:'perspective corrected + cropped'}});
   if(error)throw error;if(data?.error)throw new Error(data.error);
   URL.revokeObjectURL(url);await clearCaches();closeModal();toast('Your cover photo is now the locked cover for this copy.');window.dispatchEvent(new CustomEvent('reading-room:refresh'));
  }catch(err){btn.disabled=false;btn.textContent='Save clean cover';toast(err.message||'Could not process cover photo',true);}
 });
}

function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error||new Error('Could not read image'));r.readAsDataURL(blob);});}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function solveLinear(A,b){const n=b.length,M=A.map((row,i)=>[...row,b[i]]);for(let c=0;c<n;c++){let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[pivot][c]))pivot=r;if(Math.abs(M[pivot][c])<1e-10)throw new Error('Cover corners are too distorted.');[M[c],M[pivot]]=[M[pivot],M[c]];const d=M[c][c];for(let j=c;j<=n;j++)M[c][j]/=d;for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];for(let j=c;j<=n;j++)M[r][j]-=f*M[c][j];}}return M.map(row=>row[n]);}
function homography(dest,src){const A=[],b=[];for(let i=0;i<4;i++){const u=dest[i].x,v=dest[i].y,x=src[i].x,y=src[i].y;A.push([u,v,1,0,0,0,-x*u,-x*v]);b.push(x);A.push([0,0,0,u,v,1,-y*u,-y*v]);b.push(y);}return solveLinear(A,b);}
async function rectifyCover(img,points,cleanup=true){
 if(!img.complete)await new Promise((res,rej)=>{img.onload=res;img.onerror=rej;});
 const maxSource=2200,rawW=img.naturalWidth,rawH=img.naturalHeight,scale=Math.min(1,maxSource/Math.max(rawW,rawH));
 const sw=Math.max(1,Math.round(rawW*scale)),sh=Math.max(1,Math.round(rawH*scale));
 const source=document.createElement('canvas');source.width=sw;source.height=sh;const sctx=source.getContext('2d',{willReadFrequently:true});sctx.drawImage(img,0,0,sw,sh);
 const srcPts=points.map(p=>({x:p.x*(sw-1),y:p.y*(sh-1)}));const avgW=(dist(srcPts[0],srcPts[1])+dist(srcPts[3],srcPts[2]))/2,avgH=(dist(srcPts[0],srcPts[3])+dist(srcPts[1],srcPts[2]))/2;
 const ratio=Math.min(.86,Math.max(.5,avgW/Math.max(1,avgH)));const oh=1400,ow=Math.max(700,Math.round(oh*ratio));
 const dest=[{x:0,y:0},{x:ow-1,y:0},{x:ow-1,y:oh-1},{x:0,y:oh-1}];const H=homography(dest,srcPts);
 const src=sctx.getImageData(0,0,sw,sh),out=document.createElement('canvas');out.width=ow;out.height=oh;const octx=out.getContext('2d');const image=octx.createImageData(ow,oh),sd=src.data,od=image.data;const [a,b,c,d,e,f,g,h]=H;
 for(let y=0;y<oh;y++)for(let x=0;x<ow;x++){const den=g*x+h*y+1,sx=(a*x+b*y+c)/den,sy=(d*x+e*y+f)/den;const oi=(y*ow+x)*4;if(sx<0||sy<0||sx>=sw-1||sy>=sh-1){od[oi]=od[oi+1]=od[oi+2]=255;od[oi+3]=255;continue;}const x0=sx|0,y0=sy|0,x1=x0+1,y1=y0+1,dx=sx-x0,dy=sy-y0,w00=(1-dx)*(1-dy),w10=dx*(1-dy),w01=(1-dx)*dy,w11=dx*dy;const i00=(y0*sw+x0)*4,i10=(y0*sw+x1)*4,i01=(y1*sw+x0)*4,i11=(y1*sw+x1)*4;od[oi]=sd[i00]*w00+sd[i10]*w10+sd[i01]*w01+sd[i11]*w11;od[oi+1]=sd[i00+1]*w00+sd[i10+1]*w10+sd[i01+1]*w01+sd[i11+1]*w11;od[oi+2]=sd[i00+2]*w00+sd[i10+2]*w10+sd[i01+2]*w01+sd[i11+2]*w11;od[oi+3]=255;}
 octx.putImageData(image,0,0);if(!cleanup)return out;const final=document.createElement('canvas');final.width=ow;final.height=oh;const fctx=final.getContext('2d');fctx.filter='contrast(1.045) saturate(1.02)';fctx.drawImage(out,0,0);return final;
}

export async function handleExactCopyAction(action, bookId) {
 const book=await fetchBook(bookId);
 if(action==='verify')return verifyCopy(book);
 if(action==='confirm-pages')return confirmPages(book);
 if(action==='photo')return openPhotoSource(book);
}
