import { rpc } from '../data/library.js';
import { cover, esc } from '../ui/format.js';
import { closeModal, showModal, toast } from '../ui/feedback.js';
import { upNextManagerRows } from './up-next-markup.js';

export function openUpNextDetails(item, books) {
  const root = showModal(`<div class="upnext-detail-shell"><button class="upnext-detail-close" type="button" data-close aria-label="Close">×</button><div class="upnext-detail-head">${cover(item, 'upnext-detail-cover')}<div class="upnext-detail-meta"><p class="upnext-source ${item.source === 'Manual' ? 'manual' : 'ai'}">${item.source === 'Manual' ? 'Your pick' : 'Librarian pick'}${item.locked ? ' · locked' : ''}</p><h2>${esc(item.title)}</h2><p class="upnext-detail-author">${esc(item.authors || 'Unknown author')}</p>${item.ai_score != null ? `<p class="upnext-detail-score">${Number(item.ai_score).toFixed(1)}/10 · ${esc(item.confidence || '')} confidence</p>` : ''}</div></div><div class="upnext-detail-reason"><h3>Why it’s up next</h3><p>${esc(item.reason || item.why_recommended || 'This is a strong fit for what you appear to want next.')}</p></div><div class="upnext-detail-actions"><button class="btn btn-primary" data-read-now type="button">Read now</button><button class="btn" data-open-queued type="button">Open book</button></div></div>`, 'upnext-detail-backdrop');
  root.querySelector('[data-open-queued]').addEventListener('click', () => { closeModal(); location.hash = `#/book/${encodeURIComponent(item.id)}`; });
  root.querySelector('[data-read-now]').addEventListener('click', async event => { event.currentTarget.disabled = true; try { const book = books.find(row => row.id === item.id) || item; await rpc('start_reading', { p_book_id: item.id, p_edition_id: book.current_edition_id || book.display_edition_id || null, p_total_pages: book.total_pages ? Number(book.total_pages) : null }); closeModal(); toast(`${item.title} is now your current read.`); window.dispatchEvent(new CustomEvent('reading-room:refresh')); } catch (error) { toast(error.message || 'Could not start this book', true); event.currentTarget.disabled = false; } });
}

export function openUpNextManager(queue, books) {
  const ids = new Set(queue.map(item => item.id));
  const remaining = books.filter(book => !ids.has(book.id) && !['Currently Reading', 'Read', 'DNF', 'Not Interested'].includes(book.overall_status));
  const root = showModal(`<div class="upnext-manager-head"><div><p class="eyebrow">Reading queue</p><h2>Manage Up Next</h2></div><button class="btn" type="button" data-close>Done</button></div><p class="upnext-manager-note">Locked items are protected from future librarian reshuffles.</p><div id="queue-manager-list">${upNextManagerRows(queue)}</div><form id="upnext-add-form" class="upnext-add-form"><label for="upnext-add-book">Add a book manually</label><select id="upnext-add-book" name="book" class="input" ${remaining.length ? '' : 'disabled'}><option value="">${remaining.length ? 'Choose a book…' : 'No eligible books available'}</option>${remaining.map(book => `<option value="${book.id}">${esc(book.title)} — ${esc(book.authors || '')}</option>`).join('')}</select><button class="btn btn-primary" type="submit" ${remaining.length ? '' : 'disabled'}>Add to queue</button></form>`);
  root.querySelector('[data-close]').addEventListener('click', closeModal);
  root.querySelectorAll('[data-queue-id]').forEach((row, index) => {
    row.querySelectorAll('[data-queue-move]').forEach(button => button.addEventListener('click', async () => { const delta = button.dataset.queueMove === 'up' ? -1 : 1; const reordered = [...queue]; [reordered[index], reordered[index + delta]] = [reordered[index + delta], reordered[index]]; await mutateQueue('up_next_reorder', { p_queue_ids: reordered.map(item => item.queue_id) }); }));
    row.querySelector('[data-queue-lock]').addEventListener('click', buttonEvent => mutateQueue('up_next_set_locked', { p_queue_id: row.dataset.queueId, p_locked: buttonEvent.currentTarget.dataset.queueLock === '1' }));
    row.querySelector('[data-queue-remove]').addEventListener('click', () => mutateQueue('up_next_remove', { p_queue_id: row.dataset.queueId }));
  });
  root.querySelector('#upnext-add-form').addEventListener('submit', event => { event.preventDefault(); if (event.currentTarget.book.value) mutateQueue('up_next_add', { p_book_id: event.currentTarget.book.value, p_source: 'Manual', p_reason: 'Added manually from Library.', p_locked: true, p_ai_score: null, p_confidence: null }); });
}

async function mutateQueue(name, args) {
  try { await rpc(name, args); closeModal(); toast('Reading queue updated.'); window.dispatchEvent(new CustomEvent('reading-room:refresh')); }
  catch (error) { toast(error.message || 'Could not update queue', true); }
}

export function openRecommendation(item) {
  const root = showModal(`<div class="recommended-detail-shell"><button class="recommended-detail-close" type="button" data-close aria-label="Close">×</button><div class="recommended-detail-head">${cover(item, 'recommended-detail-cover')}<div class="recommended-detail-meta"><span class="recommended-badge ${item.recommendation_strength === 'Wildcard' ? 'wildcard' : ''}">${esc(item.recommendation_strength || 'Recommended')}</span><h2>${esc(item.title)}</h2><p class="recommended-detail-author">${esc(item.authors || 'Unknown author')}</p>${item.match_score_10 != null ? `<p class="recommended-detail-score">Match ${Number(item.match_score_10).toFixed(1)}/10</p>` : ''}</div></div><div class="recommended-detail-reason"><h3>Why I’m recommending it</h3><p>${esc(item.why_recommended || 'Recommended from your current Taste Profile and reading feedback.')}</p></div><div class="recommended-detail-actions"><button class="btn btn-primary" data-recommend-wishlist>Add to wish list</button></div></div>`, 'recommended-detail-backdrop');
  root.querySelector('[data-recommend-wishlist]').addEventListener('click', async event => { event.currentTarget.disabled = true; try { await rpc('recommendation_add_to_wishlist', { p_recommendation_id: item.recommendation_id }); closeModal(); toast(`${item.title} added to your wish list.`); window.dispatchEvent(new CustomEvent('reading-room:refresh')); } catch (error) { toast(error.message || 'Could not add this book', true); event.currentTarget.disabled = false; } });
}

export function openRecommendationsPage(items) {
  const root = showModal(`<div class="recommended-page-shell"><header class="recommended-page-header"><button class="recommended-back" data-close type="button">←</button><div><p class="eyebrow">AI discovery</p><h1>Recommended for you</h1><p>${items.length} active picks outside your library.</p></div></header><main class="recommended-page-main"><div class="recommended-list">${items.map(item => `<article class="recommended-list-card" data-page-recommendation="${item.recommendation_id}" tabindex="0">${cover(item, 'recommended-list-cover')}<div class="recommended-list-copy"><h2>${esc(item.title)}</h2><p class="recommended-author">${esc(item.authors || 'Unknown author')}</p><p class="recommended-list-reason">${esc(item.why_recommended || '')}</p></div></article>`).join('')}</div></main></div>`, 'recommended-detail-backdrop');
  root.querySelectorAll('[data-page-recommendation]').forEach(card => card.addEventListener('click', () => openRecommendation(items.find(item => item.recommendation_id === card.dataset.pageRecommendation))));
}
