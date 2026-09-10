import { escapeHtml } from '../utils/text.js';

function identity(book) {
  return String(book.id || book.book_id || book.recommendation_id || `${book.title || 'book'}:${book.authors || ''}`);
}

export function coverMarkup(book, extraClass = '', { eager = false, high = false } = {}) {
  const url = String(book.cover_url || '');
  const key = identity(book);
  const image = url
    ? `<img class="cover-image" src="${escapeHtml(url)}" data-cover-url="${escapeHtml(url)}" alt="Cover of ${escapeHtml(book.title)}" loading="${eager || high ? 'eager' : 'lazy'}" fetchpriority="${high ? 'high' : 'auto'}" decoding="async" width="400" height="600">`
    : '';
  return `<div class="cover ${extraClass}" data-cover-key="${escapeHtml(key)}" data-cover-url="${escapeHtml(url)}"><div class="cover-fallback"><small>${escapeHtml(book.primary_genre || 'Library')}</small><strong>${escapeHtml(book.title)}</strong></div>${image}</div>`;
}

function reveal(image) {
  const expected = image.dataset.coverUrl || '';
  const container = image.closest('.cover');
  if (!container || !image.isConnected || container.dataset.coverUrl !== expected) return;
  if (image.naturalWidth > 0) {
    image.hidden = false;
    container.classList.remove('cover-failed');
    container.classList.add('cover-loaded');
  }
}

function fail(image) {
  const container = image.closest('.cover');
  if (!container || container.dataset.coverUrl !== image.dataset.coverUrl) return;
  container.classList.remove('cover-loaded');
  container.classList.add('cover-failed');
  image.hidden = true;
}

export function activateCovers(root = document) {
  root.querySelectorAll('.cover-image').forEach(image => {
    if (!image.dataset.coverBound) {
      image.dataset.coverBound = '1';
      image.addEventListener('load', () => reveal(image));
      image.addEventListener('error', () => fail(image));
    }
    if (image.complete) {
      if (image.naturalWidth > 0) reveal(image);
      else fail(image);
    }
  });
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
  root.querySelectorAll('.cover[data-cover-key] .cover-image').forEach(placeholder => {
    const container = placeholder.closest('.cover');
    const key = `${container.dataset.coverKey}\n${container.dataset.coverUrl}`;
    const reusable = pool.get(key)?.shift();
    if (!reusable) return;
    reusable.loading = placeholder.loading;
    reusable.fetchPriority = placeholder.fetchPriority;
    placeholder.replaceWith(reusable);
    if (!reusable.hidden && reusable.naturalWidth > 0) container.classList.add('cover-loaded');
  });
  if (activate) activateCovers(root);
}
