const DETAIL_CACHE_KEYS=['librariangpt-detail-cache-v3','library-detail-cache-v4'];
const MUTATING='[data-progress],[data-start],[data-finish],[data-pause],[data-dnf],[data-status="wishlist"]';
function clearDetailCaches(){DETAIL_CACHE_KEYS.forEach(key=>localStorage.removeItem(key));}
document.addEventListener('click',event=>{if(event.target.closest(MUTATING)){clearDetailCaches();window.LibraryDataCache?.clear?.();}},{capture:true});
