import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.querySelector('#app');
const FAILURE_KEY = 'librariangpt-cover-failures-v1';
const FAILURE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const failures = loadFailures();
let running = false;

function loadFailures() {
  try { return JSON.parse(localStorage.getItem(FAILURE_KEY) || '{}'); }
  catch { return {}; }
}

function saveFailures() {
  try { localStorage.setItem(FAILURE_KEY, JSON.stringify(failures)); } catch {}
}

function recentlyFailed(id) {
  const stamp = Number(failures[id] || 0);
  return stamp && Date.now() - stamp < FAILURE_RETRY_MS;
}

function markFailed(id) {
  failures[id] = Date.now();
  saveFailures();
}

function clearFailed(id) {
  if (failures[id]) {
    delete failures[id];
    saveFailures();
  }
}

function escSelector(value) {
  return window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&');
}

function paintCover(bookId, title, url) {
  if (!url || !app) return;
  const covers = new Set();
  app.querySelectorAll(`[data-book-id="${escSelector(bookId)}"] .cover`).forEach(node => covers.add(node));
  app.querySelectorAll('.detail-header').forEach(detail => {
    const detailTitle = detail.querySelector('.detail-copy h1')?.textContent?.trim();
    if (detailTitle === title) {
      const cover = detail.querySelector('.cover');
      if (cover) covers.add(cover);
    }
  });

  covers.forEach(cover => {
    let img = cover.querySelector('img');
    if (!img) {
      img = document.createElement('img');
      img.alt = `Cover of ${title}`;
      img.loading = 'lazy';
      const fallback = cover.querySelector('.cover-fallback');
      cover.insertBefore(img, fallback || cover.firstChild);
    }
    img.onerror = () => img.remove();
    if (img.src !== url) img.src = url;
  });
}

async function edgeError(error, fallback) {
  if (!error) return fallback;
  try {
    if (error.context instanceof Response) {
      const payload = await error.context.clone().json();
      return payload?.error || error.message || fallback;
    }
  } catch {}
  return error.message || fallback;
}

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(await edgeError(error, `${name} failed`));
  if (data?.error) throw new Error(data.error);
  return data;
}

async function refreshOwnedCover(book) {
  const isbn = book.isbn13 || book.isbn10;
  if (!isbn || recentlyFailed(book.id)) return false;
  try {
    const result = await invoke('cover-refresh', { book_id: book.id, isbn });
    if (result?.cover_url) paintCover(book.id, book.title, result.cover_url);
    clearFailed(book.id);
    return Boolean(result?.cover_url);
  } catch (error) {
    console.info(`[LibrarianGPT] Exact cover unavailable for ${book.title}:`, error.message);
    markFailed(book.id);
    return false;
  }
}

async function enrichReferenceCover(book) {
  if (recentlyFailed(book.id)) return false;
  try {
    const result = await invoke('book-metadata', {
      book_id: book.id,
      owned: false,
      title: book.title,
      author: String(book.authors || '').split(',')[0].trim() || null
    });
    const url = result?.metadata?.cover_url;
    if (url) paintCover(book.id, book.title, url);
    clearFailed(book.id);
    return Boolean(url);
  } catch (error) {
    console.info(`[LibrarianGPT] Reference cover unavailable for ${book.title}:`, error.message);
    markFailed(book.id);
    return false;
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runQueue(items, worker, concurrency = 2) {
  let cursor = 0;
  async function next() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
      await sleep(180);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}

async function enrichCovers() {
  if (running) return;
  running = true;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: books, error } = await supabase.from('v_library')
      .select('id,title,authors,ownership_status,overall_status,isbn10,isbn13,cover_url,cover_source,cover_verified,reference_edition_id');
    if (error || !books?.length) return;

    const owned = books.filter(book =>
      book.ownership_status === 'Owned' &&
      (book.isbn13 || book.isbn10) &&
      (!book.cover_url || !book.cover_verified)
    );

    for (const book of owned) {
      await refreshOwnedCover(book);
      await sleep(120);
    }

    const references = books.filter(book =>
      book.ownership_status !== 'Owned' &&
      ['Recommended', 'Wishlist'].includes(book.overall_status) &&
      !book.cover_url
    );

    await runQueue(references, enrichReferenceCover, 2);
  } catch (error) {
    console.info('[LibrarianGPT] Cover enrichment paused:', error.message);
  } finally {
    running = false;
  }
}

function refreshVisibleVerifiedCovers() {
  supabase.from('v_library')
    .select('id,title,cover_url')
    .not('cover_url', 'is', null)
    .then(({ data }) => data?.forEach(book => paintCover(book.id, book.title, book.cover_url)))
    .catch(() => {});
}

if (app) {
  new MutationObserver(() => refreshVisibleVerifiedCovers()).observe(app, { childList: true, subtree: true });
}

window.addEventListener('load', () => {
  setTimeout(() => {
    refreshVisibleVerifiedCovers();
    enrichCovers();
  }, 900);
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) setTimeout(enrichCovers, 700);
});
