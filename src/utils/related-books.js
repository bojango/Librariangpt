const RELATED_CACHE_VERSION = 1;
const RELATED_CACHE_PREFIX = `reading-room-related-v${RELATED_CACHE_VERSION}:`;
export const RELATED_BOOKS_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const normaliseTitle = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

function relatedCacheKey(bookId) {
  return `${RELATED_CACHE_PREFIX}${String(bookId || '')}`;
}

export function relatedStatus(item) {
  if (item?.overall_status === 'Read') return { icon: '✓', label: 'Read' };
  if (item?.overall_status === 'Wishlist') return { icon: '♡', label: 'Wishlist' };
  if (item?.ownership_status === 'Owned' || ['Currently Reading', 'Owned - Unread', 'Paused'].includes(item?.overall_status)) return { icon: '▣', label: 'Owned' };
  return { icon: '+', label: 'Not in your library' };
}

export function excludeSeriesFromAuthor(seriesBooks = [], authorBooks = []) {
  const ids = new Set(seriesBooks.map(item => item.book_id || item.id).filter(Boolean));
  const titles = new Set(seriesBooks.map(item => normaliseTitle(item.title)).filter(Boolean));
  return authorBooks.filter(item => {
    const id = item.book_id || item.id;
    return !ids.has(id) && !titles.has(normaliseTitle(item.title));
  });
}

export function relatedDiscoveryKey(item) {
  return String(item?.book_id || item?.id || item?.discovery_id || item?.provider_id || normaliseTitle(item?.title));
}

export function normaliseRelatedItem(item = {}) {
  const coverUrl = item.cover_url || item.cover_url_preferred || item.display_cover_url || item.cover || null;
  return { ...item, cover_url: coverUrl };
}

function workIdentity(item) {
  const value=item.open_library_work_id || item.work_id || item.add_payload?.open_library_work_id
    || [item.discovery_id,item.provider_id].find(id=>/^(?:\/works\/)?OL\d+W$/.test(String(id || '')));
  return value?String(value).replace(/^\/works\//,''):null;
}

function sameSeriesWork(a,b) {
  const aBook=a.book_id || (a.kind==='library'?a.id:null),bBook=b.book_id || (b.kind==='library'?b.id:null);
  if(aBook&&bBook&&aBook===bBook) return true;
  const aWork=workIdentity(a),bWork=workIdentity(b);
  if(aWork&&bWork) return aWork===bWork;
  // Distinct canonical identities, positions or years must not be collapsed
  // by a shared title. Anonymous edition discoveries need corroborating authors.
  if(aBook&&bBook) return false;
  if(a.series_order!=null&&b.series_order!=null&&Number(a.series_order)!==Number(b.series_order)) return false;
  if(a.publication_year&&b.publication_year&&Number(a.publication_year)!==Number(b.publication_year)) return false;
  const authors=item=>(Array.isArray(item.authors)?item.authors:String(item.authors || item.author || '').split(',')).map(normaliseTitle).filter(Boolean).sort().join('|');
  return Boolean(normaliseTitle(a.title)&&authors(a))&&normaliseTitle(a.title)===normaliseTitle(b.title)&&authors(a)===authors(b);
}

export function dedupeSeriesBooks(items=[]) {
  const result=[];
  for(const item of items) {
    const index=result.findIndex(previous=>sameSeriesWork(previous,item));
    if(index<0) result.push(item);
    else if((item.book_id || item.kind==='library')&&!(result[index].book_id || result[index].kind==='library')) result[index]=item;
  }
  return result;
}

function mergeItem(previous, next) {
  const a = normaliseRelatedItem(previous);
  const b = normaliseRelatedItem(next);
  const merged = { ...a, ...b };
  for (const key of Object.keys(a)) {
    if ((merged[key] == null || merged[key] === '') && a[key] != null && a[key] !== '') merged[key] = a[key];
  }
  if (!b.cover_url && a.cover_url) merged.cover_url = a.cover_url;
  return merged;
}

export function mergeRelatedItems(previous = [], next = []) {
  const merged = new Map();
  [...previous, ...next].forEach(item => {
    if (!item?.title) return;
    const key = relatedDiscoveryKey(item);
    merged.set(key, merged.has(key) ? mergeItem(merged.get(key), item) : normaliseRelatedItem(item));
  });
  return [...merged.values()];
}

export function mergeRelatedData(cached, refreshed) {
  const normaliseSeries=data=>data?.series?{...data,series:{...data.series,books:dedupeSeriesBooks(data.series.books || [])}}:data;
  cached=normaliseSeries(cached);
  refreshed=normaliseSeries(refreshed);
  if (!cached) return refreshed;
  if (!refreshed) return cached;
  const mergeShelf = (oldShelf, newShelf) => {
    if (!oldShelf && !newShelf) return null;
    if (!oldShelf) return newShelf;
    if (!newShelf) return oldShelf;
    const oldBooks = Array.isArray(oldShelf.books) ? oldShelf.books : [];
    const newBooks = Array.isArray(newShelf.books) ? newShelf.books : [];
    if (!newBooks.length && oldBooks.length) return oldShelf;
    return { ...oldShelf, ...newShelf, books: mergeRelatedItems(oldBooks, newBooks) };
  };
  return normaliseSeries({ ...cached, ...refreshed, series: mergeShelf(cached.series, refreshed.series), author: mergeShelf(cached.author, refreshed.author) });
}

export function relatedDataFingerprint(data) {
  try { return JSON.stringify(data ?? null); }
  catch { return ''; }
}

export function readRelatedCache(storage, bookId, now = Date.now()) {
  if (!storage || !bookId) return null;
  const key = relatedCacheKey(bookId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    const savedAt = Number(cached?.saved_at);
    const age = Math.max(0, Number(now) - savedAt);
    if (cached?.version !== RELATED_CACHE_VERSION || !Number.isFinite(savedAt) || age > RELATED_BOOKS_CACHE_MAX_AGE_MS || !cached?.data) {
      storage.removeItem(key);
      return null;
    }
    return cached.data;
  } catch {
    try { storage.removeItem(key); } catch {}
    return null;
  }
}

export function writeRelatedCache(storage, bookId, data, now = Date.now()) {
  if (!storage || !bookId || !data) return false;
  try {
    storage.setItem(relatedCacheKey(bookId), JSON.stringify({
      version: RELATED_CACHE_VERSION,
      saved_at: Number(now),
      data
    }));
    return true;
  } catch {
    return false;
  }
}
