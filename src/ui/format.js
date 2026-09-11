import { escapeHtml } from '../utils/text.js';
import { coverMarkup } from './cover.js';

export { escapeHtml as esc };

const DAY_MS = 24 * 60 * 60 * 1000;

function dayStamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function fmtDate(value) {
  if (!value) return 'Not recorded';
  try { return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)); }
  catch { return String(value); }
}

export function readingDayCount(startedAt, endedAt = null, now = new Date()) {
  const start = dayStamp(startedAt);
  const end = dayStamp(endedAt || now);
  if (start == null || end == null) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

export function readingAgeText(startedAt, now = new Date()) {
  const days = readingDayCount(startedAt, null, now);
  if (days == null) return '';
  if (days === 0) return 'Started today';
  return `${days} day${days === 1 ? '' : 's'} reading`;
}

export function readingDurationText(startedAt, completedAt = null, now = new Date()) {
  const days = readingDayCount(startedAt, completedAt, now);
  if (days == null) return '';
  if (completedAt) return days === 0 ? 'Read in < 1 day' : `Read in ${days} day${days === 1 ? '' : 's'}`;
  return days === 0 ? 'Started today' : `${days} day${days === 1 ? '' : 's'} reading`;
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

const STATUS_CLASSES = new Map([
  ['Currently Reading', 'currently-reading'],
  ['Read', 'read'],
  ['Wishlist', 'wishlist'],
  ['Owned', 'owned'],
  ['Owned - Unread', 'owned'],
  ['Paused', 'paused'],
  ['DNF', 'dnf'],
  ['Not Interested', 'not-interested']
]);

export function statusPill(status) {
  const label = String(status || '').trim();
  if (!label) return '';
  const kind = STATUS_CLASSES.get(label) || 'neutral';
  const icon = kind === 'read' ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8.25 3.1 3.1L13 4.75"/></svg>' : '';
  return `<span class="status-pill status-${kind}">${icon}<span>${escapeHtml(label)}</span></span>`;
}

export function coverPalette(title = '') {
  let hash = 2166136261;
  for (const char of title) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const palettes = [['#59422d','#1d1917'],['#2f4c48','#151c1b'],['#4a3c54','#19161d'],['#59404a','#1d1619'],['#3e4a2f','#171b13'],['#36506a','#141a20'],['#6a5134','#201912'],['#4d4439','#171512']];
  return palettes[Math.abs(hash) % palettes.length];
}

export function cover(book, extraClass = '', options = {}) {
  const [a, b] = coverPalette(book.title);
  return coverMarkup(book, extraClass, options).replace('class="cover ', `style="--cover-a:${a};--cover-b:${b}" class="cover `);
}
