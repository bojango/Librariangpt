import { catalogueCollections, catalogueWorks } from '../data/collection-catalogue.js';

export const normaliseIdentity = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g,'');
export const workRouteId = work => work.book_id || `catalogue:${work.key}`;

export function resolveWork(work, books = []) {
  if (work.book_id) return books.find(book=>book.id===work.book_id) || null;
  const matches = [...new Map(books.filter(book=>normaliseIdentity(book.title)===normaliseIdentity(work.title)
    && normaliseIdentity(book.authors)===normaliseIdentity(work.authors)).map(book=>[book.id,book])).values()];
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
  const library = new Map((state.books || []).map(book=>[book.id,book]));
  const recommendations = new Map();
  for (const rec of state.recommendations || []) if (!recommendations.has(rec.book_id)) recommendations.set(rec.book_id,rec);
  const workMap = new Map(works.map(work=> {
    const canonical = resolveWork(work,allBooks);
    const owned = library.get(canonical?.id || work.book_id);
    return [work.key,{...work,book_id:canonical?.id || work.book_id || null,cover_url:owned?.cover_url || canonical?.cover_url_preferred || work.cover_url,
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
    return {...collection,works:unique,path,pathWorks,recommended,total:unique.length,owned:unique.filter(work=>work.library?.ownership_status==='Owned').length,read,progress:unique.length ? Math.round(read/unique.length*100) : 0};
  });
}

export function collectionMemberships(state,book) {
  return buildCollections(state).flatMap(collection=> {
    const work=collection.works.find(work=>work.book_id===book.id || workRouteId(work)===book.id);
    if (!work) return [];
    const entry=collection.pathWorks.find(item=>item.key===work.key);
    const next=collection.recommended.find(item=>item.selection!=='optional' && item.library?.overall_status!=='Read' && item.key!==work.key && (!entry || item.position>entry.position));
    return [{collection,work,entry,next}];
  });
}

export function catalogueBook(state,id) {
  for (const collection of buildCollections(state)) {
    const work=collection.works.find(work=>workRouteId(work)===id);
    if(work) return {id:workRouteId(work),title:work.title,authors:work.authors,original_publication_year:work.publication_year,cover_url:work.cover_url,overall_status:work.library?.overall_status || 'Not in Library',ownership_status:work.library?.ownership_status || 'Not Owned',catalogue_only:!work.library,source_url:work.source_url};
  }
  return null;
}
