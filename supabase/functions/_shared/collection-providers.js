import {normalize,authorKey,identifiers,discoverCollections} from './collection-discovery.js';
import {isValidIsbn,cleanIsbn} from './edition-ranking.js';

const publishers=['hachettebookgroup.com','hachette.co.uk','hachette.com.au','penguinrandomhouse.com','penguinrandomhouse.ca','penguin.co.uk','panmacmillan.com','panmacmillan.com.au','us.macmillan.com','simonandschuster.com','harpercollins.com','harpercollins.co.uk','bloomsbury.com','baen.com','quarto.com'];
export function authorityUrl(value,extraHosts=[]) {
  try {
    const url=new URL(value);
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&[...publishers,...extraHosts].some(host=>url.hostname===host||url.hostname.endsWith(`.${host}`))?url.href:null;
  } catch {return null;}
}
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
const type=(node,name)=>[node?.['@type']].flat().includes(name);
const names=value=>[value].flat().map(a=>typeof a==='string'?a:a?.name).filter(Boolean).join(', ');
const isbnIds=value=>[value].flat().filter(isValidIsbn).map(v=>`isbn:${cleanIsbn(v)}`);
const numeric=value=>value!==null&&value!==undefined&&/^\d+(?:\.\d{1,2})?$/.test(String(value))&&Number(value)<1000000?Number(value):null;
const year=value=>/^\d{4}/.test(String(value))?Number(String(value).slice(0,4)):null;
function structured(document) {
  const documents=[];
  if(typeof document==='string') {
    for(const match of document.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) try {documents.push(JSON.parse(match[1]));} catch { /* malformed evidence is not authority */ }
  } else documents.push(document);
  const nodes=[];
  const visit=(value,depth=0)=>{if(!value||typeof value!=='object'||depth>10||nodes.length>=5000)return;if(Array.isArray(value)){value.forEach(v=>visit(v,depth+1));return;}nodes.push(value);Object.values(value).forEach(v=>visit(v,depth+1));};
  documents.forEach(d=>visit(d));return nodes;
}

// First-party JSON-LD only: no prose/array-position inference. Unknown domains,
// publisher imprints and ambiguous work/position collisions remain candidates.
export async function publisherCatalogue(document,sourceUrl,book,{extraHosts=[],now=Date.now()}={}) {
  if(!authorityUrl(sourceUrl,extraHosts)) return null;
  const nodes=structured(document);
  const resolve=node=>node?.['@id']?[...nodes.filter(n=>n['@id']===node['@id'])].sort((a,b)=>Object.keys(b).length-Object.keys(a).length)[0]||node:node;
  for(const series of nodes.filter(n=>type(n,'BookSeries'))) {
    if(!series.name||/classics|masterworks|collected works|box\s?set/i.test(series.name)) continue;
    const raw=series.hasPart || series.itemListElement || [];
    const parts=[...(Array.isArray(raw)?raw:raw.itemListElement || [])];
    if(parts.length<2||parts.length>250) continue;
    const works=[],members=[];let invalid=false;
    for(const part of parts) {
      const item=resolve(part.item || part);
      if(!type(item,'Book')||!item.name||!names(item.author)) {invalid=true;continue;}
      const number=numeric(part.position ?? item.position);
      const ids=isbnIds(item.isbn);
      const key=`work:${await hash(`${authorKey(names(item.author))}:${normalize(item.name)}`)}`;
      if(works.some(w=>w.key===key||ids.some(id=>w.identifiers.includes(id)))||members.some(m=>number!==null&&m.official_number===number)) {invalid=true;break;}
      const published=Date.parse(item.datePublished || '');
      works.push({key,title:item.name,authors:names(item.author),identifiers:ids,publication_year:year(item.copyrightYear || item.datePublished),publication_state:Number.isFinite(published)&&published>now?'forthcoming':'published',cover_url:typeof item.image==='string'&&item.image.startsWith('https://')?item.image:null,source_url:sourceUrl,verified_at:new Date(now).toISOString().slice(0,10)});
      members.push({work_key:key,official_number:number});
    }
    if(invalid||works.length<2||!works.some(w=>normalize(w.title)===normalize(book.title)&&authorKey(w.authors)===authorKey(book.authors))) continue;
    const key=`publisher:${await hash(`${new URL(sourceUrl).hostname}:${normalize(series.name)}:${[...new Set(works.map(w=>authorKey(w.authors)))].sort().join(';')}`)}`;
    const total=series.numberOfItems ?? series.numberOfBooks;
    return {version:1,verified_at:new Date(now).toISOString().slice(0,10),works,collections:[{key,name:series.name,kind:'series',source_url:sourceUrl,verified_at:new Date(now).toISOString().slice(0,10),complete:Number.isInteger(total)&&total===works.length&&!series.nextPage,
      description:'Publisher-supplied series catalogue. Only explicitly documented positions are numbered; completeness requires a declared total.',verification:'authoritative_jsonld',identity_authors:[...new Set(works.map(w=>w.authors))].sort().join('; '),members}]};
  }
  return null;
}

// Preserve backend keys and provenance. A database catalogue can learn new
// series without a code release; the static registry is only a seed/fallback.
export function mergeDiscoveryRegistry(snapshot,seed) {
  const works=[...seed.works],collections=seed.collections.map(c=>({...c,members:c.members.map(m=>({...m}))}));
  const remap=new Map();
  for(const w of snapshot.works || []) {
    if(w.provenance?.type==='existing_database') continue;
    const matches=works.filter(x=>normalize(x.title)===normalize(w.title)&&authorKey(x.authors)===authorKey(w.authors));
    const old=works.find(x=>x.key===w.key)||(matches.length===1?matches[0]:null);
    if(old) {remap.set(old.key,w.key);works.splice(works.indexOf(old),1,{...old,...w,identifiers:w.provenance?.identifiers || old.identifiers || []});}
    else works.push({...w,identifiers:w.provenance?.identifiers || []});
  }
  for(const c of collections) c.members=c.members.map(m=>({...m,work_key:remap.get(m.work_key)||m.work_key}));
  for(const c of snapshot.collections || []) {
    if(c.provenance?.type==='existing_database') continue;
    const members=(snapshot.memberships || []).filter(m=>m.collection_key===c.key).map(m=>({work_key:m.work_key,official_number:m.official_number}));
    const old=collections.find(x=>sameCollection(x,c,members));
    const merged=old?[...old.members.map(m=>({...m})),...members.filter(m=>!old.members.some(n=>n.work_key===m.work_key))]:members;
    const definition={...c.provenance,...c,description:old?.description || c.description,complete:Boolean(old?.complete&&merged.length===old.members.length||c.complete&&merged.length===members.length),catalogue_type:old?.catalogue_type || c.catalogue_type,members:merged};
    if(old) collections.splice(collections.indexOf(old),1,definition); else collections.push(definition);
  }
  for(const source of snapshot.sources || []) if(source.status==='verified'&&validCatalogue(source.catalogue)) {
    const aliases=new Map();
    for(const w of source.catalogue.works) {
      const matches=works.filter(x=>x.key===w.key||normalize(x.title)===normalize(w.title)&&authorKey(x.authors)===authorKey(w.authors));
      if(matches.length===1) aliases.set(w.key,matches[0].key);else if(!matches.length) works.push(w);
    }
    for(const c of source.catalogue.collections) {
      const members=c.members.map(m=>({...m,work_key:aliases.get(m.work_key)||m.work_key}));
      const old=collections.find(x=>sameCollection(x,c,members));
      if(old) {
        const merged=[...old.members,...members.filter(m=>!old.members.some(n=>n.work_key===m.work_key))];
        collections.splice(collections.indexOf(old),1,{...c,key:old.key,series_id:old.series_id,members:merged,complete:c.complete&&merged.length===members.length});
      }else collections.push({...c,members});
    }
  }
  return {...seed,works,collections};
}
function sameCollection(a,b,members) {
  if(a.key===b.key) return true;
  if(a.kind!==b.kind) return false;
  const names=[b.name,...(b.aliases || []),...(b.provenance?.aliases || [])].map(normalize);
  return [a.name,...(a.aliases || [])].some(n=>names.includes(normalize(n)))&&members.some(m=>a.members.some(n=>n.work_key===m.work_key));
}
function validCatalogue(c) {
  return Array.isArray(c?.works)&&c.works.length<=500&&c.works.every(w=>w.key&&w.title&&authorKey(w.authors))&&
    Array.isArray(c.collections)&&c.collections.length<=50&&c.collections.every(s=>s.key&&s.name&&Array.isArray(s.members)&&s.members.every(m=>c.works.some(w=>w.key===m.work_key)));
}

function verifiedGoogleVolume(volume,book) {
  const v=volume?.volumeInfo;if(!v||normalize(v.title)!==normalize(book.title)||authorKey(v.authors)!==authorKey(book.authors)) return false;
  const actual=identifiers(book).filter(i=>i.startsWith('isbn:'));
  return actual.length>0&&isbnIds((v.industryIdentifiers || []).map(i=>i.identifier)).some(id=>actual.includes(id));
}
// Google series membership is a reliable provider candidate; only a first-party
// publisher assertion or explicit service verification promotes it to official.
export async function googleSeriesCandidate(book,fetchJson) {
  let volume=(book.editions || []).map(e=>e.metadata_payload?.google_books).find(v=>verifiedGoogleVolume(v,book));
  if(!volume) {
    const isbn=identifiers(book).find(i=>i.startsWith('isbn:'));
    if(!isbn) return null;
    const response=await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(isbn)}&maxResults=5`);
    const matches=(response?.items || []).filter(v=>verifiedGoogleVolume(v,book));
    if(matches.length!==1) return null;volume=matches[0];
  }
  const links=volume.volumeInfo?.seriesInfo?.volumeSeries || [];
  if(links.length!==1) return links.length?{provider:'google_books',reason:'Multiple provider series identities require review.',volume_id:volume.id}:null;
  const id=links[0].seriesId;if(!id||!/^[-_a-zA-Z0-9]+$/.test(id)) return null;
  const url=`https://www.googleapis.com/books/v1/series/get?series_id=${encodeURIComponent(id)}`;
  const detail=await fetchJson(url);
  const series=detail?.series?.find(s=>s.seriesId===id);if(!series?.title) return null;
  const members=[];let token=null;
  for(let page=0;page<2;page++) {
    const response=await fetchJson(`https://www.googleapis.com/books/v1/series/membership/get?series_id=${encodeURIComponent(id)}&page_size=50${token?`&page_token=${encodeURIComponent(token)}`:''}`);
    members.push(...(response?.member || []));token=response?.nextPageToken || null;if(!token) break;
  }
  return {provider:'google_books',provider_series_id:id,name:series.title,source_url:url,verified:false,pagination_complete:!token,
    members:members.map(v=>({volume_id:v.id,title:v.volumeInfo?.title,authors:v.volumeInfo?.authors,identifiers:isbnIds((v.volumeInfo?.industryIdentifiers || []).map(i=>i.identifier)),provider_order:v.volumeInfo?.seriesInfo?.volumeSeries?.find(s=>s.seriesId===id)?.orderNumber ?? null,display_number:v.volumeInfo?.seriesInfo?.bookDisplayNumber || null})),reason:'Provider series catalogue recorded; publisher/author membership and numbering need authoritative verification.'};
}

export async function discoverExternalCollections(book,snapshot,registry,{fetchJson,fetchDocument,extraHosts=[]}={}) {
  const urls=[...new Set([...(book.editions || []).flatMap(e=>[e.metadata_payload?.source_url,e.metadata_payload?.google_books?.volumeInfo?.infoLink]),...(book.external_ids || []).map(e=>e.url)].map(u=>authorityUrl(u,extraHosts)).filter(Boolean))].slice(0,2);
  for(const url of urls) if(fetchDocument) {
    let document=await fetchDocument(url),source=url,catalogue=await publisherCatalogue(document,url,book,{extraHosts});
    if(!catalogue) {
      const linked=structured(document).filter(n=>type(n,'BookSeries')).map(n=>authorityUrl(n.url || n['@id'],extraHosts)).find(u=>u&&u!==url);
      if(linked) {document=await fetchDocument(linked);source=linked;catalogue=await publisherCatalogue(document,linked,book,{extraHosts});}
    }
    if(catalogue) {
      const merged=mergeDiscoveryRegistry({sources:[{status:'verified',catalogue}]},registry);
      const decision=discoverCollections(book,snapshot,merged);
      if(decision.status==='linked') return {...decision,source_catalogue:{key:catalogue.collections[0].key,source_url:source,status:'verified',catalogue}};
    }
  }
  if(fetchJson) {
    const candidate=await googleSeriesCandidate(book,fetchJson);
    if(candidate) return {status:'unresolved',reason:candidate.reason,candidates:[candidate],collections:[],works:[]};
  }
  return null;
}
