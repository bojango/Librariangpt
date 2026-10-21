import { catalogueCollections, catalogueWorks } from '../data/collection-catalogue.js';
import { collectionArtwork } from '../data/collection-artwork.js';

const PRESENTATION = {
  'preston-child': { short_description:'Pendergast, Nora Kelly and Corrie Swanson in one connected world.' },
  'pendergast': { parent_key:'preston-child', short_description:'The Agent Pendergast novels, in official series order.' },
  'nora-kelly': { parent_key:'preston-child', short_description:'Nora Kelly and Corrie Swanson’s archaeological investigations.' },
  'nora-corrie': { parent_key:'preston-child', short_description:'Nora and Corrie’s appearances across the connected series.' },
  'jurassic-park': { short_description:'Michael Crichton’s two Jurassic Park novels.' },
  'silo': { short_description:'Wool, Shift and Dust: Hugh Howey’s core trilogy.' }
};
export const isPublished = work => work.publication_state!=='forthcoming';
export function readingProgress(works,{excludeSkipped=true}={}) {
  const eligible=works.filter(work=>isPublished(work)&&(!excludeSkipped||work.selection!=='skipped'));
  return {total:eligible.length,read:eligible.filter(work=>work.library?.overall_status==='Read').length};
}

export const normaliseIdentity = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
export const normaliseAuthors = value => (Array.isArray(value)?value:String(value || '').split(',')).map(normaliseIdentity).filter(Boolean).sort().join('|');
export const workRouteId = work => work.book_id || `catalogue:${work.key}`;

export function resolveWork(work, books = []) {
  if (work.book_id) return books.find(book=>book.id===work.book_id) || null;
  const matches = [...new Map(books.filter(book=>normaliseIdentity(book.title)===normaliseIdentity(work.title)
    && normaliseAuthors(book.authors)===normaliseAuthors(work.authors)).map(book=>[book.id,book])).values()];
  return matches.length===1 ? matches[0] : null;
}

export function buildCollections(state) {
  const data = state.collectionData || {};
  const definitions = [...(data.collections?.length ? data.collections : catalogueCollections)];
  const works = [...(data.works?.length ? data.works : catalogueWorks)];
  // Preserve pre-existing series beyond the verified starter catalogues.
  // Their recorded titles are explicitly distinguished from a complete catalogue.
  for(const series of data.series || []) {
    if(definitions.some(c=>c.series_id===series.id || normaliseIdentity(c.name)===normaliseIdentity(series.name))) continue;
    const links=(data.bookSeries || []).filter(link=>link.series_id===series.id);
    if(!links.length) continue;
    const members=[];
    for(const link of links) {
      const book=(data.books || []).find(b=>b.id===link.book_id) || (state.books || []).find(b=>b.id===link.book_id);
      if(!book) continue;
      const key=`book:${book.id}`;
      if(!works.some(w=>w.key===key)) works.push({key,book_id:book.id,title:book.title,authors:book.authors,publication_year:book.original_publication_year});
      members.push({work_key:key,official_number:link.series_order});
    }
    definitions.push({key:`series:${series.id}`,series_id:series.id,name:series.name,kind:'series',description:series.notes || 'Titles recorded in your existing series catalogue. The full external catalogue has not yet been verified.',complete:false,verified:false,members});
  }
  const allBooks = [...(data.books || []),...(state.books || [])];
  // Optional author collections are a view of known canonical works, not a
  // claim to be an official series or a complete external bibliography.
  for(const name of data.authorCollections || ['Michael Crichton']) {
    const members=[];
    for(const book of [...new Map(allBooks.map(b=>[b.id,b])).values()]) {
      if(!String(book.authors || '').split(', ').some(author=>normaliseIdentity(author)===normaliseIdentity(name))) continue;
      let work=works.find(w=>w.book_id===book.id || resolveWork(w,[book]));
      if(!work) {work={key:`book:${book.id}`,book_id:book.id,title:book.title,authors:book.authors,publication_year:book.original_publication_year};works.push(work);}
      members.push({work_key:work.key,official_number:null});
    }
    if(members.length) definitions.push({key:`author:${normaliseIdentity(name)}`,name,kind:'author',verified:false,complete:false,description:`Books by ${name} recorded in your catalogue. An author collection, not an official series or a complete bibliography.`,short_description:`Books by ${name} from your catalogue.`,members});
  }
  const library = new Map((state.books || []).map(book=>[book.id,book]));
  const recommendations = new Map();
  for (const rec of state.recommendations || []) if (!recommendations.has(rec.book_id)) recommendations.set(rec.book_id,rec);
  const workMap = new Map(works.map(work=> {
    const canonical = resolveWork(work,allBooks);
    const owned = library.get(canonical?.id || work.book_id);
    const artwork=collectionArtwork[work.key];
    const existingCover=owned?.cover_url || canonical?.cover_url_preferred || work.cover_url;
    const officialSeries=definitions.filter(c=>c.kind==='series').flatMap(c=>{
      const member=(c.members || (data.memberships || []).filter(m=>m.collection_key===c.key)).find(m=>m.work_key===work.key);
      return member?[{key:c.key,name:c.name,number:member.official_number}]:[];
    });
    return [work.key,{...work,book_id:canonical?.id || work.book_id || null,cover_url:existingCover || artwork?.cover_url,
      artwork_source:existingCover?null:artwork?.source_url,add_payload:artwork?.isbn13 || artwork?.isbn10 ? {title:work.title,authors:work.authors.split(', '),isbn13:artwork.isbn13,isbn10:artwork.isbn10,provider:'Author/publisher catalogue',source_url:artwork.source_url} : null,official_series:officialSeries,
      library:owned || null,recommendation:recommendations.get(canonical?.id || work.book_id) || null}];
  }));
  const paths = data.paths || [];
  return definitions.map(collection=> {
    const path = paths.find(path=>path.collection_key===collection.key);
    const entries = path ? (data.entries || []).filter(entry=>entry.path_id===path.id).sort((a,b)=>a.position-b.position) : [];
    const members = (collection.members || (data.memberships || []).filter(row=>row.collection_key===collection.key))
      .map(m=>({...workMap.get(m.work_key),official_number:m.official_number})).filter(work=>work.key);
    const unique = [...new Map(members.map(work=>[work.key,{...work,...entries.find(entry=>entry.work_key===work.key)}])).values()];
    unique.sort((a,b)=>collection.kind==='series' ? (a.official_number??Infinity)-(b.official_number??Infinity) || (a.publication_year??Infinity)-(b.publication_year??Infinity) || a.title.localeCompare(b.title)
      : (a.publication_year??Infinity)-(b.publication_year??Infinity) || a.title.localeCompare(b.title));
    // Paths may deliberately cross series boundaries. Resolve against all works.
    const pathWorks = entries.map(entry=>({...workMap.get(entry.work_key),official_number:unique.find(w=>w.key===entry.work_key)?.official_number,...entry})).filter(work=>work.key);
    const recommended = path ? pathWorks.filter(work=>work.selection!=='skipped') : unique.filter(work=>work.recommendation && !['Dismissed','Not Interested'].includes(work.recommendation.recommendation_status));
    const read = unique.filter(work=>work.library?.overall_status==='Read').length;
    const published=unique.filter(isPublished);
    return {...collection,...PRESENTATION[collection.key],works:unique,path,pathWorks,recommended,total:unique.length,published:published.length,forthcoming:unique.length-published.length,fullProgress:readingProgress(unique,{excludeSkipped:false}),pathProgress:readingProgress(recommended),owned:unique.filter(work=>work.library?.ownership_status==='Owned').length,read,progress:published.length ? Math.round(read/published.length*100) : 0};
  });
}

export function overviewCollections(state) {
  return buildCollections(state).filter(c=>!c.parent_key&&(c.kind!=='author'||state.showAuthorCollections));
}

export function groupedCollectionWorks(collection,works,collections) {
  if(collection.kind!=='universe') return [{key:collection.key,name:collection.kind==='author'?'Books in your catalogue':'',works}];
  const children=collections.filter(c=>c.parent_key===collection.key&&c.kind==='series');
  const used=new Set(),groups=[];
  for(const child of children) {
    const members=new Map(child.works.map(w=>[w.key,w]));
    const selected=works.filter(w=>members.has(w.key)&&!used.has(w.key)).map(w=>({...w,official_number:members.get(w.key).official_number,series_name:child.name}));
    selected.sort((a,b)=>(a.official_number??Infinity)-(b.official_number??Infinity)||(a.publication_year??Infinity)-(b.publication_year??Infinity));
    if(selected.length) {selected.forEach(w=>used.add(w.key));groups.push({key:child.key,name:child.name,works:selected});}
  }
  const standalone=works.filter(w=>!used.has(w.key));
  if(standalone.length) groups.push({key:'standalone',name:'Standalone introductions',works:standalone});
  return groups;
}

export function collectionMemberships(state,book) {
  return buildCollections(state).flatMap(collection=> {
    const work=collection.works.find(work=>work.book_id===book.id || workRouteId(work)===book.id);
    if (!work) return [];
    const entry=collection.pathWorks.find(item=>item.key===work.key);
    const next=collection.recommended.find(item=>item.selection!=='optional' && isPublished(item) && item.library?.overall_status!=='Read' && item.key!==work.key && (!entry || item.position>entry.position));
    return [{collection,work,entry,next}];
  });
}

export function catalogueBook(state,id) {
  for (const collection of buildCollections(state)) {
    const work=collection.works.find(work=>workRouteId(work)===id);
    if(work) return {id:workRouteId(work),work_key:work.key,title:work.title,authors:work.authors,original_publication_year:work.publication_year,cover_url:work.cover_url,artwork_source:work.artwork_source,publication_state:work.publication_state,overall_status:work.library?.overall_status || 'Not in Library',ownership_status:work.library?.ownership_status || 'Not Owned',catalogue_only:!work.library,source_url:work.source_url};
  }
  return null;
}
