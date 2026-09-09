const SHELL='librariangpt-shell-v41';
const COVERS='librariangpt-covers-v2';
const ASSETS=['./','./index.html','./styles.css?v=41','./ui-v3.css?v=41','./chapter.css?v=41','./perf-v14.css?v=41','./book-admin-v15.css?v=41','./up-next-v16.css?v=41','./recommended-v23.css?v=41','./edition-browser-v20.css?v=41','./exact-copy-v22.css?v=41','./ui-fixes-v24.css?v=41','./cover-upload-v25.css?v=41','./branding-v27.css?v=41','./library-admin-v30.css?v=41','./stability-v32.css?v=41','./current-reading-carousel-v36.css?v=41','./current-reading-layout-v37.css?v=41','./quotes-v40.css?v=41','./stability-v41.css?v=41','./data-cache.js?v=41','./app.js?v=41','./cache-hooks.js?v=41','./ui-v3.js?v=41','./chapter-addon.js?v=41','./book-admin-v15.js?v=41','./up-next-v16.js?v=41','./recommended-v23.js?v=41','./edition-browser-v20.js?v=41','./exact-copy-v22.js?v=41','./cover-upload-v25.js?v=41','./library-admin-v30.js?v=41','./current-reading-carousel-v36.js?v=41','./current-reading-layout-v37.js?v=41','./quotes-v40.js?v=41','./supabase-config.js','./manifest.webmanifest?v=41','./assets/reading-room-mark.svg','./assets/reading-room-app-icon.svg','./icons/icon-192.png','./icons/icon-512.png','./assets/goodreads.svg','./assets/google-books.svg','./assets/open-library.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>(k.startsWith('librariangpt-shell-')&&k!==SHELL)||(k.startsWith('librariangpt-covers-')&&k!==COVERS)).map(k=>caches.delete(k)))));self.clients.claim();});
function isCover(url,request){if(request.destination!=='image')return false;return url.hostname==='covers.openlibrary.org'||url.hostname.endsWith('googleusercontent.com')||url.hostname==='books.google.com'||url.hostname.endsWith('.supabase.co');}
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);
 if(isCover(url,event.request)){
  event.respondWith(caches.open(COVERS).then(async cache=>{
   const hit=await cache.match(event.request);
   // User-uploaded Supabase artwork is network-first because the object URL can stay the same after replacement.
   if(url.hostname.endsWith('.supabase.co')){try{const response=await fetch(event.request);if(response.ok||response.type==='opaque')await cache.put(event.request,response.clone());return response;}catch{return hit||new Response('',{status:504,statusText:'Cover unavailable'});}}
   // External catalogue artwork is cache-first for smooth scrolling, but quietly refreshed in the background.
   if(hit){event.waitUntil(fetch(event.request).then(response=>{if(response.ok||response.type==='opaque')return cache.put(event.request,response.clone());}).catch(()=>{}));return hit;}
   try{const response=await fetch(event.request);if(response.ok||response.type==='opaque')await cache.put(event.request,response.clone());return response;}catch{return new Response('',{status:504,statusText:'Cover unavailable'});}
  }));return;
 }
 if(url.origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(SHELL).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('./index.html'))));
});
