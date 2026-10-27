// Work-level decisions only. Missing provider data never proves a standalone.
import {cleanIsbn,isValidIsbn} from './edition-ranking.js';
export const normalize = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
export const authorKey = value => (Array.isArray(value) ? value : String(value || '').split(',')).map(normalize).filter(Boolean).sort().join('|');
const unique = values => [...new Set(values.filter(Boolean))];
export function identifiers(book) {
  const external=(book.external_ids || []).filter(e=>/open.?library/i.test(e.provider)).flatMap(e=>{
    const id=String(e.external_id || e.url || '').match(/(?:^|\/works\/)(OL\d+W)$/)?.[1];
    return id?[`ol:${id}`]:[];
  });
  return unique([...external,...(book.editions || []).flatMap(e => [
    e.open_library_work_id && `ol:${e.open_library_work_id.replace('/works/','')}`,
    ...(e.metadata_payload?.open_library?.works || []).map(w => `ol:${String(w.key).replace('/works/','')}`),
    ...[e.isbn13,e.isbn10].filter(isValidIsbn).map(isbn => `isbn:${cleanIsbn(isbn)}`)
  ])]);
}

export function matchWork(book, works, books = [book]) {
  if (!authorKey(book.authors)) return { reason:'Missing canonical author identity.' };
  const ids = identifiers(book);
  const candidates = works.filter(w => authorKey(w.authors) === authorKey(book.authors) && (
    normalize(w.title) === normalize(book.title) || (w.aliases || []).some(t => normalize(t) === normalize(book.title)) ||
    (w.identifiers || []).some(id => ids.includes(id))
  ));
  if (candidates.length !== 1) return { reason: candidates.length ? 'Multiple verified works match this identity.' : 'No verified catalogue or explicit standalone evidence for this work.' };
  const work = candidates[0];
  // Reject conflicting stable work identities even if title and author agree.
  const expected = (work.identifiers || []).filter(id => id.startsWith('ol:'));
  const actual = ids.filter(id => id.startsWith('ol:'));
  if (actual.length > 1 || (expected.length && actual.length && !actual.some(id => expected.includes(id)))) return { reason:'Conflicting underlying work identifiers.' };
  const canonical = books.filter(b => authorKey(b.authors) === authorKey(book.authors) && (
    normalize(b.title) === normalize(work.title) || (work.aliases || []).some(t => normalize(t) === normalize(b.title)) ||
    (work.identifiers || []).some(id => identifiers(b).includes(id))
  ));
  if (canonical.length !== 1) return { reason:'Duplicate canonical works require review; editions were not merged.' };
  return { work, basis: (work.identifiers || []).some(id => ids.includes(id)) ? 'stable_identifier_and_author' : 'exact_title_and_author' };
}

export function discoverCollections(book, snapshot, registry) {
  const match = matchWork(book, registry.works, snapshot.books);
  const existing = (snapshot.book_series || []).filter(m => m.book_id === book.id);
  if (!match.work) return { status:'unresolved', reason:match.reason, existing_memberships:existing, candidates:providerHints(book), collections:[], works:[] };
  const work = match.work;
  const collections = registry.collections.filter(c => c.members.some(m => m.work_key === work.key));
  // Catalogue the verified subseries of a discovered universe even when none of
  // those additional works is currently owned. No reading-path rows are used.
  for(let added=true;added;) {
    added=false;
    const keys=new Set(collections.flatMap(c=>c.members.map(m=>m.work_key)));
    for(const c of registry.collections) if(!collections.some(row=>row.key===c.key)&&c.members.some(m=>keys.has(m.work_key))) {collections.push(c);added=true;}
  }
  if (!collections.length && work.standalone === true && existing.length) return {status:'unresolved',reason:'Explicit standalone evidence conflicts with an existing series relationship.',existing_memberships:existing,collections:[],works:[]};
  const keys = new Set(collections.flatMap(c => c.members.map(m => m.work_key)));
  const works = registry.works.filter(w => keys.has(w.key)).map(w => {
    const matches = snapshot.books.filter(b => matchWork(b, [w], snapshot.books).work);
    const canonical = matches.length === 1 ? matches[0] : null;
    const editionCover = canonical?.editions?.find(e => e.cover_url)?.cover_url;
    return {...w,book_id:canonical?.id || null,canonical_title:canonical?.title || null,canonical_authors:canonical?.authors || null,cover_url:canonical?.cover_url_preferred || editionCover || w.cover_url || null};
  });
  return { status:collections.length ? 'linked' : work.standalone === true ? 'standalone' : 'unresolved',
    reason:collections.length ? `Verified ${match.basis}; official catalogues retained separately from reading paths.` : work.standalone === true ? (work.verification==='explicit_standalone_bibliography'?'Explicit standalone classification in the cited bibliography.':'Explicit author/publisher standalone classification.') : 'No verified membership.',
    work_key:work.key,basis:match.basis,source_url:work.source_url,verified_at:work.verified_at || registry.verified_at,
    existing_memberships:existing,collections,works };
}

export function providerHints(book) {
  return (book.editions || []).flatMap(e => {
    const p = e.metadata_payload || {};
    return [p.open_library?.series,p.open_library_work?.series,p.google_books?.volumeInfo?.seriesInfo]
      .filter(Boolean).map(value => ({edition_id:e.id,value,verified:false}));
  });
}

// Only a corroborated work/ISBN is queried. No title-only external lookup.
// Evidence already fetched by metadata enrichment is always reused first.
export async function discoverWithProviders(book, snapshot, registry, options = {}) {
  const {fetchJson}=options;
  const {mergeDiscoveryRegistry,discoverExternalCollections}=await import('./collection-providers.js');
  const effective=mergeDiscoveryRegistry(snapshot,registry);
  const decision = discoverCollections(book,snapshot,effective);
  if (decision.status !== 'unresolved') return decision;
  const external=await discoverExternalCollections(book,snapshot,effective,options);
  if(external) return {...external,existing_memberships:decision.existing_memberships};
  if (!fetchJson || decision.candidates?.length) return decision;
  const ids = identifiers(book), work = ids.find(id => /^ol:OL\d+W$/.test(id));
  const isbn = ids.find(id => /^isbn:(?:\d{13}|\d{9}[\dX])$/.test(id));
  const url = work ? `https://openlibrary.org/works/${work.slice(3)}.json` : isbn ? `https://openlibrary.org/isbn/${isbn.slice(5)}.json` : null;
  if (!url) return decision;
  const cached = (book.editions || []).some(e => work ? e.metadata_payload?.open_library_work : e.metadata_payload?.open_library);
  if (cached) return decision;
  const evidence = await fetchJson(url);
  // A provider's series hint is a review candidate, never an official number.
  if (evidence?.series) decision.candidates = [{source_url:url,value:evidence.series,verified:false}];
  return {...decision,provider_evidence: evidence ? {source_url:url,key:evidence.key,series:evidence.series || null} : null};
}
