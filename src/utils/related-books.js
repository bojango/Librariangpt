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
  return { ...cached, ...refreshed, series: mergeShelf(cached.series, refreshed.series), author: mergeShelf(cached.author, refreshed.author) };
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
