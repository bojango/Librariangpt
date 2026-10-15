import { currentlyReadingBooks } from '../../src/utils/currently-reading.js';
import { progressPct } from '../../src/ui/format.js';

export const WIDGET_FIELDS = 'id,title,authors,overall_status,started_at,current_page,total_pages,progress_percent,cover_url';

export async function loadCurrentBook(client, signal) {
  const { data, error, status } = await client.from('v_library').select(WIDGET_FIELDS)
    .eq('overall_status', 'Currently Reading')
    .order('started_at', { ascending: false, nullsFirst: false }).order('title').limit(1)
    .abortSignal(signal);
  if (error) throw Object.assign(new Error('Widget data request failed.'), { status: status || error.status });
  return widgetBook(currentlyReadingBooks(data || [])[0]);
}

export function smallCover(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (url.hostname === 'covers.openlibrary.org' && /^\/b\/(id|isbn|olid)\/[\w-]+-[SML]\.jpg$/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/-[SML]\.jpg$/, '-M.jpg');
      url.search = '?default=false';
      return url.href;
    }
    if ((url.hostname === 'books.google.com' || url.hostname === 'books.googleusercontent.com') && url.pathname === '/books/content') {
      // Rebuild the thumbnail URL; discard auth/signature or unrelated params.
      const id = url.searchParams.get('id');
      if (!id) return '';
      url.search = new URLSearchParams({ id, printsec: 'frontcover', img: '1', zoom: '1', source: 'gbs_api' }).toString();
      return url.href;
    }
  } catch {}
  // Unknown/original uploads can be unbounded. Prefer the lightweight fallback.
  return '';
}

export function widgetBook(book) {
  if (!book) return null;
  const number = value => Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
  const total = number(book.total_pages);
  return {
    id: String(book.id), title: String(book.title || 'Untitled book').slice(0, 240),
    authors: String(book.authors || 'Unknown author').slice(0, 160),
    percent: total > 0 ? Math.round(progressPct(book)) : null,
    pages: number(book.current_page), total: total || null,
    cover: smallCover(book.cover_url)
  };
}
