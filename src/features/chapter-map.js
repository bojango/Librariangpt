const DAY_MS = 24 * 60 * 60 * 1000;

export const CHAPTER_MAP_NOT_FOUND_COOLDOWN_MS = 30 * DAY_MS;
export const CHAPTER_MAP_FAILED_COOLDOWN_MS = DAY_MS;

function checkedAt(row) {
  const value = Date.parse(row?.chapter_map_last_checked_at || '');
  return Number.isFinite(value) ? value : null;
}

export function shouldMapCurrentChapters(row, now = Date.now()) {
  if (!row || row.overall_status !== 'Currently Reading' || !row.display_edition_id) return false;
  if (row.has_chapter_map || row.current_chapter_id) return false;
  const status = String(row.chapter_map_status || '').trim().toLowerCase();
  if (['available', 'partial', 'manual'].includes(status)) return false;
  const lastChecked = checkedAt(row);
  if (lastChecked == null) return true;
  const cooldown = status === 'not_found' ? CHAPTER_MAP_NOT_FOUND_COOLDOWN_MS : CHAPTER_MAP_FAILED_COOLDOWN_MS;
  return now - lastChecked >= cooldown;
}

function wasAttempted(storage, key) {
  try { return storage?.getItem(key) != null; }
  catch { return false; }
}

function markAttempted(storage, key, now) {
  try { storage?.setItem(key, String(now)); }
  catch {}
}

export async function maybeMapCurrentChapters(snapshot, { invoke, refresh, storage = globalThis.sessionStorage, now = Date.now() } = {}) {
  if (typeof invoke !== 'function') return { attempted: 0, imported: 0 };
  const currentBookIds = new Set((snapshot?.books || []).filter(book => book.overall_status === 'Currently Reading').map(book => book.id));
  const candidates = (snapshot?.chapters || []).filter(row => currentBookIds.has(row.id) && shouldMapCurrentChapters(row, now));
  let attempted = 0;
  let imported = 0;
  await Promise.all(candidates.map(async row => {
    const key = `reading-room-chapter-map:${row.display_edition_id}`;
    if (wasAttempted(storage, key)) return;
    markAttempted(storage, key, now);
    attempted += 1;
    try {
      const result = await invoke('chapter-map', { book_id: row.id });
      if (result?.ok && Number(result.imported) > 0) imported += Number(result.imported);
    } catch (error) {
      console.info('[Reading Room] chapter mapping deferred:', error?.message || error);
    }
  }));
  if (imported > 0 && typeof refresh === 'function') await refresh();
  return { attempted, imported };
}
