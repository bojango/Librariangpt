// Bibliographic facts only. This module never creates a canonical/Library book.
import {isValidIsbn} from './edition-ranking.js';
export const identity = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
const authors = value => (Array.isArray(value)?value:String(value || '').split(',')).map(identity).filter(Boolean).sort().join('|');
export const sameWork = (work,title,names) => identity(work.title)===identity(title)&&authors(work.authors)===authors(names);
export const plain = value => String(typeof value==='object'?value?.value || '':value || '').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
const year=value=>/^\d{4}/.test(String(value))&&Number(String(value).slice(0,4))>=1&&Number(String(value).slice(0,4))<=2200?Number(String(value).slice(0,4)):null;
export function googleCandidate(work,item) {
 const v=item?.volumeInfo;
 if(!v||!sameWork(work,v.title,v.authors)) return null;
 return {synopsis:plain(v.description),publication_year:year(v.publishedDate),cover_url:(v.imageLinks?.thumbnail || v.imageLinks?.smallThumbnail || '').replace(/^http:/,'https:'),
  source_url:`https://books.google.com/books?id=${encodeURIComponent(item.id)}`,provider:'Google Books',provider_id:item.id};
}
export function publisherCandidate(work,document,source_url,{trustedWorkPage=false}={}) {
 const docs=[];
 for(const match of String(document).matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) try{docs.push(JSON.parse(match[1]));}catch{/* ignore invalid structured data */}
 const visit=(v,depth=0)=>{
  if(!v||typeof v!=='object'||depth>8)return null;
  if([v['@type']].flat().includes('Book')&&sameWork(work,v.name,[v.author].flat().map(a=>typeof a==='string'?a:a?.name)))
   return {synopsis:plain(v.description),publication_year:year(v.copyrightYear || v.datePublished),cover_url:typeof v.image==='string'?v.image:v.image?.url,source_url,provider:'Author / publisher'};
  for(const child of Object.values(v)){const result=visit(child,depth+1);if(result)return result;}return null;
 };
 for(const doc of docs){const result=visit(doc);if(result)return result;}
 // A reviewed author-artwork link identifies this exact work. Require its
 // title on the fetched page before accepting that page's factual description.
 const exactHeading=[...String(document).matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].some(m=>identity(plain(m[1]))===identity(work.title));
 const namedAuthors=String(work.authors || '').split(',').every(name=>identity(plain(document)).includes(identity(name)));
 if((trustedWorkPage||namedAuthors)&&exactHeading) {
  const tags=[...String(document).matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]);
  for(const tag of tags.filter(t=>/(?:name|property)=["'](?:og:description|description)["']/i.test(t))) {
   const content=tag.match(/content="([^"]*)"/i)||tag.match(/content='([^']*)'/i);const synopsis=plain(content?.[1]);
   if(synopsis.length>=100){
    const image=tags.find(t=>/(?:name|property)=["']og:image["']/i.test(t));
    const cover=image?.match(/content="([^"]*)"/i)||image?.match(/content='([^']*)'/i);
    return {synopsis,cover_url:cover?.[1]?.replaceAll('&amp;','&'),source_url,provider:'Author / publisher book page'};
   }
  }
 }
 return null;
}
export function publisherBookLink(work,document,sourceUrl) {
 const matches=[];
 for(const m of String(document).matchAll(/<a\b([^>]*\bhref=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
  const label=m[1].match(/aria-label=["']([^"']+)["']/i)?.[1],alt=m[3].match(/<img\b[^>]*alt=["']([^"']+)["']/i)?.[1];
  if(![plain(m[3]),label,alt].some(v=>v&&identity(v)===identity(work.title)))continue;
  try{const u=new URL(m[2].replaceAll('&amp;','&'),sourceUrl),origin=new URL(sourceUrl);if(u.protocol==='https:'&&u.hostname===origin.hostname&&!u.username&&!u.password&&!u.port&&u.pathname!==origin.pathname)matches.push(u.href);}catch{/* ignore malformed links */}
 }
 return [...new Set(matches)].slice(0,1)[0] || null;
}
export function imageSize(bytes) {
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length>24&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71) return [view.getUint32(16),view.getUint32(20)];
 if(bytes[0]===255&&bytes[1]===216) {
  for(let i=2;i+8<bytes.length;) {
   if(bytes[i]!==255){i++;continue;}const marker=bytes[i+1];if(marker===217||marker===218)break;
   if(marker>=192&&marker<=195||marker>=197&&marker<=199||marker>=201&&marker<=203||marker>=205&&marker<=207) return [view.getUint16(i+7),view.getUint16(i+5)];
   const size=view.getUint16(i+2);if(size<2)break;i+=size+2;
  }
 }
 if(bytes.length>30&&new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP') {
  const kind=new TextDecoder().decode(bytes.slice(12,16));
  if(kind==='VP8X')return [1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16),1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16)];
  if(kind==='VP8 ')return [view.getUint16(26,true)&16383,view.getUint16(28,true)&16383];
 }
 return null;
}
export async function verifiedCover(url,request) {
 if(!url||/\/(?:smedia|InteriorImage)(?:\/|\?|$)|\/1200x630w[pz]*\.|(?:^|[-_/])(?:logo|placeholder|no[-_]?cover)(?:[-_.\/]|$)/i.test(url))return null;
 const response=await request(url,'image');
 if(!response)return null;
 const {bytes,type}=response,size=imageSize(bytes);
 if(!/^image\/(jpeg|png|webp)/.test(type)||bytes.length<1000||!size||size[0]<60||size[1]<80||size[0]>size[1]*1.5)return null;
 return {cover_url:url,cover_verified:true,cover_validation:{content_type:type,bytes:bytes.length,width:size[0],height:size[1]}};
}

export async function enrichCatalogueWork(work,{canonical=null,cached=[],artwork=null,request,publisherAllowed=()=>false}) {
 if(artwork?.title&&!sameWork(work,artwork.title,artwork.authors))artwork=null;
 const result={synopsis:work.synopsis || canonical?.synopsis || null,publication_year:work.publication_year || canonical?.original_publication_year || null,sources:[],diagnostics:[]};
 const candidates=[];
 if(canonical) {
  candidates.push({cover_url:canonical.cover_url_preferred,source_url:canonical.metadata_source?.startsWith('https://')?canonical.metadata_source:work.source_url,provider:'Existing canonical metadata'});
  if(canonical.synopsis)result.sources.push({provider:'Existing canonical metadata',source_url:work.source_url,fields:['synopsis'],book_id:canonical.id});
 }
 if(artwork)candidates.push({...artwork,provider:'Verified author / publisher artwork'});
 for(const payload of cached) {
  const candidate=googleCandidate(work,payload);
  if(candidate)candidates.push(candidate);
 }
 const apply=candidate=>{
  if(!candidate)return;
  const fields=[];
  if(!result.synopsis&&candidate.synopsis){result.synopsis=candidate.synopsis;fields.push('synopsis');}
  if(!result.publication_year&&candidate.publication_year&&candidate.provider!=='Google Books'){result.publication_year=candidate.publication_year;fields.push('edition_publication_year');}
  if(candidate.cover_url)fields.push('cover');
  if(fields.length)result.sources.push({provider:candidate.provider,source_url:candidate.source_url,fields});
 };
 for(const c of candidates)apply(c);
 // Reuse verified bibliographic identifiers before spending a search request.
 // Edition artwork is accepted only after the normal image validation below.
 const knownIsbns=[...new Set([...(work.identifiers || []),...(work.provenance?.identifiers || [])].filter(v=>typeof v==='string'&&v.startsWith('isbn:')).map(v=>v.slice(5).replaceAll('-','')).filter(isValidIsbn))].slice(0,2);
 for(const isbn of knownIsbns)candidates.push({cover_url:`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,source_url:`https://openlibrary.org/isbn/${isbn}`,provider:'Open Library ISBN edition artwork'});
 // Validate selected artwork first. A failed manual selection stays selected.
 const initial=work.cover_url || canonical?.cover_url_preferred;
 const diagnostic=(stage,e)=>{result.diagnostics.push({stage,error:e.message});if(e.retryAfter&&(!result.retry_after||e.retryAfter>result.retry_after))result.retry_after=e.retryAfter;};
 if(initial)try{Object.assign(result,await verifiedCover(initial,request));}catch(e){diagnostic('existing_cover',e);}
 const needCover=()=>!work.cover_locked&&!work.cover_url&&!result.cover_verified;
 const verifyCandidates=async()=>{
  if(!needCover())return;
  for(const c of candidates.filter(c=>c.cover_url).slice(0,4))try{
   const verified=await verifiedCover(c.cover_url,request);if(verified){Object.assign(result,verified);apply(c);break;}
  }catch(e){diagnostic('candidate_cover',e);}
 };
 await verifyCandidates();
 if(result.synopsis&&result.publication_year&&(!needCover()||result.cover_verified))return result;
 // A known first-party book page can supply richer factual descriptions.
 const publisherUrl=artwork?.source_url&&publisherAllowed(artwork.source_url)?artwork.source_url:work.source_url;
 if(publisherAllowed(publisherUrl))try{
  const document=await request(publisherUrl,'document');let c=publisherCandidate(work,document,publisherUrl,{trustedWorkPage:publisherUrl===artwork?.source_url});
  if(!c){const link=publisherBookLink(work,document,publisherUrl);if(link&&publisherAllowed(link))c=publisherCandidate(work,await request(link,'document'),link);}
  if(c){candidates.push(c);apply(c);await verifyCandidates();}
 }catch(e){diagnostic('publisher',e);}
 if(!result.synopsis||!result.publication_year||needCover())try {
  const query=new URL('https://openlibrary.org/search.json');query.searchParams.set('title',work.title);query.searchParams.set('author',work.authors);query.searchParams.set('limit','5');query.searchParams.set('fields','key,title,author_name,first_publish_year,cover_i');
  const search=await request(query.href,'json');
  const matches=(search?.docs || []).filter(d=>sameWork(work,d.title,d.author_name));
  if(matches.length===1&&/^\/works\/OL\d+W$/.test(matches[0].key)) {
   const doc=matches[0],source_url=`https://openlibrary.org${doc.key}`,detail=await request(`${source_url}.json`,'json');
   const c={synopsis:plain(detail?.description),publication_year:year(doc.first_publish_year),cover_url:doc.cover_i>0?`https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg?default=false`:null,source_url,provider:'Open Library'};
   candidates.push(c);apply(c);await verifyCandidates();
  }
 }catch(e){diagnostic('open_library',e);}
 if(!result.synopsis||!result.publication_year||needCover())try {
  const query=new URL('https://www.googleapis.com/books/v1/volumes');query.searchParams.set('q',`intitle:"${work.title}" inauthor:"${work.authors}"`);query.searchParams.set('maxResults','5');
  const response=await request(query.href,'json');
  for(const item of response?.items || []){const c=googleCandidate(work,item);if(c){candidates.push(c);apply(c);}}
  await verifyCandidates();
 }catch(e){diagnostic('google_books',e);}
 // Edition publication dates must never masquerade as a work's first publication.
 if(!work.publication_year&&!canonical?.original_publication_year) {
  const first=candidates.find(c=>c.provider==='Open Library'&&c.publication_year);
  result.publication_year=first?.publication_year || null;
 }
 return result;
}
