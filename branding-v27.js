const app=document.querySelector('#app');
let brandQueued=false;

function applyReadingRoomBrand(){
  if(document.title!=='Reading Room')document.title='Reading Room';
  const wordmark=app?.querySelector('.topbar .wordmark');
  if(!wordmark)return;

  const mark=wordmark.querySelector('.brand-mark');
  if(mark&&!mark.dataset.readingRoomMark){
    mark.dataset.readingRoomMark='1';
    mark.replaceChildren();
    const img=document.createElement('img');
    img.src='./assets/reading-room-mark.svg';
    img.alt='';
    img.decoding='async';
    mark.appendChild(img);
  }

  const label=[...wordmark.children].find(el=>el.tagName==='SPAN'&&!el.classList.contains('brand-mark'));
  if(label){
    if(label.textContent!=='Reading Room')label.textContent='Reading Room';
    if(!label.classList.contains('reading-room-wordmark'))label.classList.add('reading-room-wordmark');
  }
  if(wordmark.getAttribute('aria-label')!=='Go to Reading Room home')wordmark.setAttribute('aria-label','Go to Reading Room home');
}

function scheduleBrand(){
  if(brandQueued)return;
  brandQueued=true;
  requestAnimationFrame(()=>{
    brandQueued=false;
    applyReadingRoomBrand();
  });
}

if(app)new MutationObserver(scheduleBrand).observe(app,{childList:true,subtree:true});
window.addEventListener('load',()=>setTimeout(scheduleBrand,80));
scheduleBrand();
