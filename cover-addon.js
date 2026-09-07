import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.querySelector('#app');
const FAILURE_KEY = 'librariangpt-cover-failures-v3';
const FAILURE_RETRY_MS = 15 * 60 * 1000;
const failures = loadFailures();
const knownCovers = new Map();
const booksById = new Map();
const repairing = new Set();
let running = false;
let observerScheduled = false;

function loadFailures() { try { return JSON.parse(localStorage.getItem(FAILURE_KEY) || '{}'); } catch { return {}; } }
function saveFailures() { try { localStorage.setItem(FAILURE_KEY, JSON.stringify(failures)); } catch {} }
function recentlyFailed(id) { const stamp = Number(failures[id] || 0); return Boolean(stamp && Date.now() - stamp < FAILURE_RETRY_MS); }
function markFailed(id) { failures[id] = Date.now(); saveFailures(); }
function clearFailed(id) { if (failures[id]) { delete failures[id]; saveFailures(); } }
function isArchived(url='') { return String(url).includes('/storage/v1/object/public/book-covers/'); }
function escSelector(value) { return window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&'); }
function registerCover(bookId, title, url) { if (!url) return; knownCovers.set(bookId, { title, url }); paintCover(bookId, title, url); }
function paintCover(bookId, title, url) {
  if (!url || !app) return;
  const covers = new Set();
  app.querySelectorAll(`[data-book-id="${escSelector(bookId)}"] .cover`).forEach(node => covers.add(node));
  app.querySelectorAll('.detail-header').forEach(detail => {
    const detailTitle = detail.querySelector('.detail-copy h1')?.textContent?.trim();
    if (detailTitle === title) { const cover = detail.querySelector('.cover'); if (cover) covers.add(cover); }
  });
  covers.forEach(cover => {
    let img = cover.querySelector('img');
    if (!img) {
      img = document.createElement('img'); img.alt = `Cover of ${title}`; img.loading = 'lazy';
      const fallback = cover.querySelector('.cover-fallback'); cover.insertBefore(img, fallback || cover.firstChild);
    }
    img.onerror = () => { img.remove(); knownCovers.delete(bookId); setTimeout(() => repairCover(bookId), 1000); };
    if (img.src !== url) img.src = url;
  });
}
function applyKnownCovers() { knownCovers.forEach(({ title, url }, id) => paintCover(id, title, url)); }
async function edgeError(error, fallback) {
  if (!error) return fallback;
  try { if (error.context instanceof Response) { const payload = await error.context.clone().json(); return payload?.error || error.message || fallback; } } catch {}
  return error.message || fallback;
}
async function invoke(name, body) { const { data, error } = await supabase.functions.invoke(name, { body }); if (error) throw new Error(await edgeError(error, `${name} failed`)); if (data?.error) throw new Error(data.error); return data; }
async function refreshOwnedCover(book) {
  const isbn = book.isbn13 || book.isbn10;
  if (!isbn || recentlyFailed(book.id) || repairing.has(book.id)) return false;
  repairing.add(book.id);
  try {
    const result = await invoke('cover-refresh', { book_id: book.id, isbn });
    if (result?.cover_url) { book.cover_url = result.cover_url; book.cover_verified = true; registerCover(book.id, book.title, result.cover_url); }
    clearFailed(book.id); return Boolean(result?.cover_url);
  } catch (error) { console.info(`[Library] Exact cover unavailable for ${book.title}:`, error.message); markFailed(book.id); return false; }
  finally { repairing.delete(book.id); }
}
async function enrichReferenceCover(book) {
  if (recentlyFailed(book.id) || repairing.has(book.id)) return false;
  repairing.add(book.id);
  try {
    const result = await invoke('book-metadata', { book_id: book.id, owned: false, title: book.title, author: String(book.authors || '').split(',')[0].trim() || null });
    const url = result?.metadata?.cover_url;
    if (url) { book.cover_url = url; book.cover_verified = true; book.reference_edition_id = result.edition_id || book.reference_edition_id; registerCover(book.id, book.title, url); }
    clearFailed(book.id); return Boolean(url);
  } catch (error) { console.info(`[Library] Reference cover unavailable for ${book.title}:`, error.message); markFailed(book.id); return false; }
  finally { repairing.delete(book.id); }
}
function repairCover(bookId) {
  const book = booksById.get(bookId);
  if (!book || recentlyFailed(bookId) || repairing.has(bookId)) return;
  if (book.ownership_status === 'Owned' && (book.isbn13 || book.isbn10)) refreshOwnedCover(book);
  else if (book.ownership_status !== 'Owned' && ['Recommended', 'Wishlist'].includes(book.overall_status)) enrichReferenceCover(book);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runQueue(items, worker, concurrency = 3) {
  let cursor = 0;
  async function next() { while (cursor < items.length) { const index = cursor++; await worker(items[index]); await sleep(220); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, next));
}
async function enrichCovers() {
  if (running || document.hidden || !navigator.onLine) return;
  running = true;
  try {
    const { data: { session } } = await supabase.auth.getSession(); if (!session) return;
    const { data: books, error } = await supabase.from('v_library').select('id,title,authors,ownership_status,overall_status,isbn10,isbn13,cover_url,cover_source,cover_verified,reference_edition_id');
    if (error || !books?.length) return;
    booksById.clear();
    books.forEach(book => { booksById.set(book.id, book); if (book.cover_url) knownCovers.set(book.id, { title: book.title, url: book.cover_url }); });
    applyKnownCovers();
    const owned = books.filter(book => book.ownership_status === 'Owned' && (book.isbn13 || book.isbn10) && (!book.cover_url || !book.cover_verified || !isArchived(book.cover_url)));
    await runQueue(owned, refreshOwnedCover, 2);
    const references = books.filter(book => book.ownership_status !== 'Owned' && ['Recommended', 'Wishlist'].includes(book.overall_status) && !book.cover_url);
    await runQueue(references, enrichReferenceCover, 3);
  } catch (error) { console.info('[Library] Cover enrichment paused:', error.message); }
  finally { running = false; }
}

if (app) {
  new MutationObserver(() => {
    if (observerScheduled) return;
    observerScheduled = true;
    requestAnimationFrame(() => { observerScheduled = false; applyKnownCovers(); });
  }).observe(app, { childList: true, subtree: true });
}
window.addEventListener('load', () => setTimeout(enrichCovers, 700));
window.addEventListener('online', () => setTimeout(enrichCovers, 500));
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(enrichCovers, 500); });
setInterval(() => { if (!document.hidden) enrichCovers(); }, 5 * 60 * 1000);
supabase.auth.onAuthStateChange((_event, session) => { if (session) setTimeout(enrichCovers, 500); });
