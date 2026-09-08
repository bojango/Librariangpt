const app=document.querySelector('#app');

function applyReadingRoomBrand(){
  document.title='Reading Room';
  const wordmark=app?.querySelector('.topbar .wordmark');
  if(!wordmark)return;

  const mark=wordmark.querySelector('.brand-mark');
  if(mark&&!mark.dataset.readingRoomMark){
    mark.dataset.readingRoomMark='1';
    mark.textContent='';
    const img=document.createElement('img');
    img.src='./assets/reading-room-mark.svg';
    img.alt='Reading Room';
    img.decoding='async';
    mark.appendChild(img);
  }

  const label=[...wordmark.children].find(el=>el.tagName==='SPAN'&&!el.classList.contains('brand-mark'));
  if(label){
    label.textContent='Reading Room';
    label.classList.add('reading-room-wordmark');
  }
  wordmark.setAttribute('aria-label','Go to Reading Room home');
}

if(app){
  new MutationObserver(()=>requestAnimationFrame(applyReadingRoomBrand)).observe(app,{childList:true,subtree:true});
}
window.addEventListener('load',()=>setTimeout(applyReadingRoomBrand,80));
applyReadingRoomBrand();
