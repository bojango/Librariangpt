import { MAX_COVER_BYTES, validateCoverBytes } from './cover-image.js';

export function coverUrl(value) {
  const url=new URL(value);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80','443'].includes(url.port)) || !url.hostname.includes('.') || /^(?:\d+\.){3}\d+$/.test(url.hostname) || url.hostname.includes(':') || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(url.hostname)) throw new Error('Use an image on a public HTTP or HTTPS host.');
  return url;
}

export async function fetchCoverImage(value) {
  let url=coverUrl(value);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try {
    for(let redirect=0;redirect<=4;redirect++) {
      const response=await fetch(url,{signal:controller.signal,redirect:'manual',headers:{Accept:'image/jpeg,image/png,image/webp'}});
      if([301,302,303,307,308].includes(response.status)) {await response.body?.cancel();url=coverUrl(new URL(response.headers.get('location')||'',url).href);continue;}
      const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
      if(!response.ok || !['image/jpeg','image/png','image/webp'].includes(mime)) {await response.body?.cancel();throw new Error('The URL did not return a supported image.');}
      if(Number(response.headers.get('content-length'))>MAX_COVER_BYTES){await response.body?.cancel();throw new Error('Image exceeds 5 MB.');}
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true){const {value:chunk,done}=await reader.read();if(done)break;size+=chunk.length;if(size>MAX_COVER_BYTES){await reader.cancel();throw new Error('Image exceeds 5 MB.');}chunks.push(chunk);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      validateCoverBytes(bytes,mime);return {bytes,mime};
    }
    throw new Error('Too many image redirects.');
  } finally {clearTimeout(timer);}
}
