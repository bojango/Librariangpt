import { escapeHtml } from '../utils/text.js';

function identity(book) {
  return String(book.id || book.book_id || book.recommendation_id || `${book.title || 'book'}:${book.authors || ''}`);
}

export function coverMarkup(book, extraClass = '', { eager = false, high = false } = {}) {
  const url = String(book.cover_url || '');
  const key = identity(book);
  const image = url
    ? `<img class="cover-image" data-cover-src="${escapeHtml(url)}" data-cover-url="${escapeHtml(url)}" data-cover-eager="${eager ? '1' : '0'}" data-cover-high="${high ? '1' : '0'}" alt="Cover of ${escapeHtml(book.title)}" loading="lazy" fetchpriority="auto" decoding="async" width="400" height="600">`
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
    const priorityHigh = image.dataset.coverHigh === '1'
      || Boolean(image.closest('.detail-header'))
      || Boolean(image.closest('.current-reading-card-v36:first-child'))
      || Boolean(image.closest('.library-grid .book-card:nth-child(-n+3)'));
    const priorityEager = priorityHigh
      || image.dataset.coverEager === '1'
      || Boolean(image.closest('.library-grid .book-card:nth-child(-n+6)'));
    image.loading = priorityEager ? 'eager' : 'lazy';
    image.fetchPriority = priorityHigh ? 'high' : 'auto';
    if (!image.dataset.coverBound) {
      image.dataset.coverBound = '1';
      image.addEventListener('load', async () => {
        try { await image.decode?.(); } catch {}
        reveal(image);
      });
      image.addEventListener('error', () => fail(image));
    }
    if (image.complete) {
      if (image.naturalWidth > 0) Promise.resolve(image.decode?.()).catch(() => {}).then(() => reveal(image));
      else fail(image);
    }
    if (!image.getAttribute('src')) image.src = image.dataset.coverSrc;
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

export function reuseCoverImages(root, pool) {
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
  activateCovers(root);
}
