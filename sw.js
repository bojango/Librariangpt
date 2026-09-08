const SHELL='librariangpt-shell-v22';
const COVERS='librariangpt-covers-v1';
const ASSETS=['./','./index.html','./styles.css?v=22','./ui-v3.css?v=22','./chapter.css?v=22','./perf-v14.css?v=22','./book-admin-v15.css?v=22','./up-next-v16.css?v=22','./edition-browser-v20.css?v=22','./exact-copy-v22.css?v=22','./data-cache.js?v=22','./app.js?v=22','./perf-v14.js?v=22','./cache-hooks.js?v=22','./ui-v3.js?v=22','./chapter-addon.js?v=22','./book-admin-v15.js?v=22','./up-next-v16.js?v=22','./refresh-data-v19.js?v=22','./edition-browser-v20.js?v=22','./exact-copy-v22.js?v=22','./supabase-config.js','./manifest.webmanifest?v=22','./icons/icon-192.png','./icons/icon-512.png','./assets/goodreads.svg','./assets/google-books.svg','./assets/open-library.svg'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(SHELL).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('librariangpt-shell-')&&k!==SHELL).map(k=>caches.delete(k)))));self.clients.claim();});
function isCover(url,request){if(request.destination!=='image')return false;return url.hostname==='covers.openlibrary.org'||url.hostname.endsWith('googleusercontent.com')||url.hostname==='books.google.com'||url.hostname.endsWith('.supabase.co');}
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);
 if(isCover(url,event.request)){event.respondWith(caches.open(COVERS).then(async cache=>{const hit=await cache.match(event.request);if(hit)return hit;try{const response=await fetch(event.request);if(response.ok||response.type==='opaque')cache.put(event.request,response.clone());return response;}catch{return new Response('',{status:504,statusText:'Cover unavailable'});}}));return;}
 if(url.origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).then(response=>{const copy=response.clone();caches.open(SHELL).then(cache=>cache.put(event.request,copy));return response;}).catch(()=>caches.match(event.request).then(cached=>cached||caches.match('./index.html'))));
});
