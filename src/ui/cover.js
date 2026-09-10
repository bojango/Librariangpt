import { escapeHtml } from '../utils/text.js';

let diagnosticHook = null;
const loadStarts = new WeakMap();
let individualDiagnosticEvents = 0;
let droppedDiagnosticEvents = 0;
const INDIVIDUAL_EVENT_LIMIT = 60;

export function setCoverDiagnosticHook(hook) {
  diagnosticHook = hook;
  individualDiagnosticEvents = 0;
  droppedDiagnosticEvents = 0;
}

function coverEvent(type, payload) {
  if (!diagnosticHook) return;
  if (individualDiagnosticEvents >= INDIVIDUAL_EVENT_LIMIT) { droppedDiagnosticEvents += 1; return; }
  individualDiagnosticEvents += 1;
  diagnosticHook.event(type, payload);
}

function safeDomain(url) {
  try { return new URL(url, location.href).hostname || 'same-origin'; }
  catch { return 'invalid'; }
}

function identity(book) {
  return String(book.id || book.book_id || book.recommendation_id || `${book.title || 'book'}:${book.authors || ''}`);
}

export function coverMarkup(book, extraClass = '', { eager = false, high = false } = {}) {
  const url = String(book.cover_url || '');
  const key = identity(book);
  const bookId = String(book.id || book.book_id || book.recommendation_id || '');
  const image = url
    ? `<img class="cover-image" src="${escapeHtml(url)}" data-cover-url="${escapeHtml(url)}" alt="Cover of ${escapeHtml(book.title)}" loading="${eager || high ? 'eager' : 'lazy'}" fetchpriority="${high ? 'high' : 'auto'}" decoding="async" width="400" height="600">`
    : '';
  coverEvent('cover_markup_created', { book_id: book.id || book.book_id || book.recommendation_id || null, provider_domain: safeDomain(url), loading: eager || high ? 'eager' : 'lazy', fetch_priority: high ? 'high' : 'auto', has_cover: Boolean(url) });
  return `<div class="cover ${extraClass}" data-cover-key="${escapeHtml(key)}" data-cover-book-id="${escapeHtml(bookId)}" data-cover-url="${escapeHtml(url)}"><div class="cover-fallback"><small>${escapeHtml(book.primary_genre || 'Library')}</small><strong>${escapeHtml(book.title)}</strong></div>${image}</div>`;
}

function reveal(image) {
  const expected = image.dataset.coverUrl || '';
  const container = image.closest('.cover');
  if (!container || !image.isConnected || container.dataset.coverUrl !== expected) return;
  if (image.naturalWidth > 0) {
    image.hidden = false;
    container.classList.remove('cover-failed');
    container.classList.add('cover-loaded');
    const started = loadStarts.get(image);
    if (started != null) coverEvent('cover_load_complete', { book_id: container.dataset.coverBookId || null, provider_domain: safeDomain(expected), natural_width: image.naturalWidth, natural_height: image.naturalHeight, duration_ms: Math.round(performance.now() - started) });
    loadStarts.delete(image);
  }
}

function fail(image) {
  const container = image.closest('.cover');
  if (!container || container.dataset.coverUrl !== image.dataset.coverUrl) return;
  container.classList.remove('cover-loaded');
  container.classList.add('cover-failed');
  image.hidden = true;
  const started = loadStarts.get(image);
  if (started != null) coverEvent('cover_load_failed', { book_id: container.dataset.coverBookId || null, provider_domain: safeDomain(image.dataset.coverUrl), duration_ms: Math.round(performance.now() - started) });
  loadStarts.delete(image);
}

export function activateCovers(root = document) {
  const images = [...root.querySelectorAll('.cover-image')];
  const summary = { total: images.length, complete_immediately: 0, waiting: 0, reused: 0, newly_created: 0, failed: 0 };
  images.forEach(image => {
    if (!image.dataset.coverBound) {
      image.dataset.coverBound = '1';
      summary.newly_created += 1;
      loadStarts.set(image, performance.now());
      const container = image.closest('.cover');
      coverEvent('cover_load_start', { book_id: container?.dataset.coverBookId || null, provider_domain: safeDomain(image.dataset.coverUrl), loading: image.loading, fetch_priority: image.fetchPriority || image.getAttribute('fetchpriority'), already_complete: image.complete });
      image.addEventListener('load', () => reveal(image));
      image.addEventListener('error', () => fail(image));
    } else summary.reused += 1;
    if (image.complete) {
      summary.complete_immediately += 1;
      if (image.naturalWidth > 0) reveal(image); else { summary.failed += 1; fail(image); }
    } else summary.waiting += 1;
  });
  diagnosticHook?.event('cover_activation_summary', { ...summary, individual_events_sampled: individualDiagnosticEvents, individual_events_dropped: droppedDiagnosticEvents });
  individualDiagnosticEvents = 0;
  droppedDiagnosticEvents = 0;
  return summary;
}

export function collectCoverImages(root) {
  const pool = new Map();
  root.querySelectorAll('.cover[data-cover-key] .cover-image').forEach(image => {
    const container = image.closest('.cover');
    const key = `${container.dataset.coverKey}\n${container.dataset.coverUrl}`;
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(image);
  });
  return pool;
}

export function reuseCoverImages(root, pool, { activate = true } = {}) {
  let reused = 0;
  root.querySelectorAll('.cover[data-cover-key] .cover-image').forEach(placeholder => {
    const container = placeholder.closest('.cover');
    const key = `${container.dataset.coverKey}\n${container.dataset.coverUrl}`;
    const reusable = pool.get(key)?.shift();
    if (!reusable) return;
    reused += 1;
    reusable.loading = placeholder.loading;
    reusable.fetchPriority = placeholder.fetchPriority;
    placeholder.replaceWith(reusable);
    if (!reusable.hidden && reusable.naturalWidth > 0) container.classList.add('cover-loaded');
    coverEvent('cover_node_reused', { book_id: container.dataset.coverBookId || null, provider_domain: safeDomain(container.dataset.coverUrl), complete: reusable.complete, natural_width: reusable.naturalWidth });
  });
  if (activate) activateCovers(root);
  return reused;
}
