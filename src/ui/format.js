import { escapeHtml } from '../utils/text.js';

export { escapeHtml as esc };

export function fmtDate(value) {
  if (!value) return 'Not recorded';
  try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)); }
  catch { return String(value); }
}

export function progressPct(book) {
  const value = Number(book.progress_percent);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

export function progressText(book) {
  if (book.current_page == null && book.total_pages == null) return 'Progress not recorded';
  if (book.total_pages == null) return `Page ${book.current_page ?? 0}`;
  return `Page ${book.current_page ?? 0} of ${book.total_pages}`;
}

export function coverPalette(title = '') {
  let hash = 2166136261;
  for (const char of title) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const palettes = [['#59422d','#1d1917'],['#2f4c48','#151c1b'],['#4a3c54','#19161d'],['#59404a','#1d1619'],['#3e4a2f','#171b13'],['#36506a','#141a20'],['#6a5134','#201912'],['#4d4439','#171512']];
  return palettes[Math.abs(hash) % palettes.length];
}

export function cover(book, extraClass = '') {
  const [a, b] = coverPalette(book.title);
  const image = book.cover_url ? `<img src="${escapeHtml(book.cover_url)}" alt="Cover of ${escapeHtml(book.title)}" loading="lazy" decoding="async">` : '';
  return `<div class="cover ${extraClass}" style="--cover-a:${a};--cover-b:${b}">${image}<div class="cover-fallback"><small>${escapeHtml(book.primary_genre || 'Library')}</small><strong>${escapeHtml(book.title)}</strong></div></div>`;
}
