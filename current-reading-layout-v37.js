const app=document.querySelector('#app');
let queued=false;

function lineCount(el){
  const style=getComputedStyle(el);
  const line=parseFloat(style.lineHeight)||parseFloat(style.fontSize)||1;
  return Math.max(1,Math.round(el.scrollHeight/line));
}

function fitTitle(hero){
  const title=hero.querySelector('.hero-copy h1');
  const copy=hero.querySelector('.hero-copy');
  if(!title||!copy)return;
  title.classList.remove('current-title-compact-v37','current-title-tight-v37');
  let lines=lineCount(title);
  if(lines>2)title.classList.add('current-title-compact-v37');
  lines=lineCount(title);
  const available=Math.max(0,hero.clientHeight-36);
  if(lines>3||copy.scrollHeight>available){
    title.classList.remove('current-title-compact-v37');
    title.classList.add('current-title-tight-v37');
  }
}

function fitAll(){
  document.querySelectorAll('.current-reading-card-v36').forEach(fitTitle);
}
function schedule(){
  if(queued)return;
  queued=true;
  requestAnimationFrame(()=>{
    queued=false;
    fitAll();
    requestAnimationFrame(fitAll);
  });
}

window.addEventListener('reading-room-current-carousel-ready',schedule);
window.addEventListener('resize',schedule,{passive:true});
window.addEventListener('load',()=>setTimeout(schedule,520));
window.addEventListener('library-data-updated',()=>setTimeout(schedule,160));
if(app)new MutationObserver(schedule).observe(app,{childList:true,subtree:true});
