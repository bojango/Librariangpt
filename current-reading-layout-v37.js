const app=document.querySelector('#app');
let resizeTimer=0;
let lastWidth=window.innerWidth;

function lineCount(el){
  const style=getComputedStyle(el);
  const line=parseFloat(style.lineHeight)||parseFloat(style.fontSize)||1;
  return Math.max(1,Math.round(el.scrollHeight/line));
}

function fitTitle(hero){
  const title=hero.querySelector('.hero-copy h1');
  const copy=hero.querySelector('.hero-copy');
  if(!title||!copy||title.dataset.titleFitV38==='done')return;

  /* Measure once from the natural title size. Do not repeatedly remove and
     re-add fit classes: that caused long titles to oscillate visibly. */
  title.classList.remove('current-title-compact-v37','current-title-tight-v37');
  title.style.transition='none';
  void title.offsetHeight;

  const naturalLines=lineCount(title);
  const available=Math.max(0,hero.clientHeight-36);

  if(naturalLines>3){
    title.classList.add('current-title-tight-v37');
  }else if(naturalLines>2){
    title.classList.add('current-title-compact-v37');
    void title.offsetHeight;
    if(lineCount(title)>3||copy.scrollHeight>available){
      title.classList.remove('current-title-compact-v37');
      title.classList.add('current-title-tight-v37');
    }
  }else if(copy.scrollHeight>available){
    title.classList.add('current-title-compact-v37');
  }

  title.dataset.titleFitV38='done';
  requestAnimationFrame(()=>{title.style.removeProperty('transition');});
}

function fitAll(){
  document.querySelectorAll('.current-reading-card-v36').forEach(fitTitle);
}

function resetAndFit(){
  document.querySelectorAll('.current-reading-card-v36 .hero-copy h1').forEach(title=>delete title.dataset.titleFitV38);
  requestAnimationFrame(fitAll);
}

window.addEventListener('reading-room-current-carousel-ready',()=>requestAnimationFrame(fitAll));
window.addEventListener('load',()=>setTimeout(fitAll,520));
window.addEventListener('resize',()=>{
  clearTimeout(resizeTimer);
  resizeTimer=setTimeout(()=>{
    const width=window.innerWidth;
    if(Math.abs(width-lastWidth)<8)return;
    lastWidth=width;
    resetAndFit();
  },140);
},{passive:true});
