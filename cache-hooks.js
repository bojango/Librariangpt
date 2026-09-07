const DETAIL_CACHE_KEY='librariangpt-detail-cache-v3';
const MUTATING='[data-progress],[data-start],[data-finish],[data-pause],[data-dnf],[data-status="wishlist"]';
document.addEventListener('click',event=>{if(event.target.closest(MUTATING))localStorage.removeItem(DETAIL_CACHE_KEY);},{capture:true});
