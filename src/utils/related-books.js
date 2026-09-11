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
  return String(item?.discovery_id || item?.provider_id || normaliseTitle(item?.title));
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
