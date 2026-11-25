import { rpc } from '../data/library.js';
import { cover, esc } from '../ui/format.js';
import { closeModal, showModal, toast } from '../ui/feedback.js';
import { upNextManagerRows } from './up-next-markup.js';
import { canQueueBook } from './up-next.js';
import { upNextMetadata } from './up-next-metadata.js';

export function openUpNextDetails(item, books) {
  const root = showModal(`<div class="upnext-detail-shell"><button class="upnext-detail-close" type="button" data-close aria-label="Close">×</button><div class="upnext-detail-head">${cover(item, 'upnext-detail-cover')}<div class="upnext-detail-meta"><p class="upnext-source ${item.source === 'Manual' ? 'manual' : 'ai'}">${item.source === 'Manual' ? 'Your pick' : 'Librarian pick'}${item.locked ? ' · locked' : ''}</p><h2>${esc(item.title)}</h2><p class="upnext-detail-author">${esc(item.authors || 'Unknown author')}</p>${upNextMetadata(item, { detailed: true })}</div></div><div class="upnext-detail-reason"><h3>Why it’s up next</h3><p>${esc(item.reason || item.why_recommended || 'This is a strong fit for what you appear to want next.')}</p></div><div class="upnext-detail-actions"><button class="btn btn-primary" data-read-now type="button">Read now</button><button class="btn" data-open-queued type="button">Open book</button></div></div>`, 'upnext-detail-backdrop');
  root.querySelector('[data-open-queued]').addEventListener('click', () => { closeModal(); location.hash = `#/book/${encodeURIComponent(item.id)}`; });
  root.querySelector('[data-read-now]').addEventListener('click', async event => { event.currentTarget.disabled = true; try { const book = books.find(row => row.id === item.id) || item; await rpc('start_reading', { p_book_id: item.id, p_edition_id: book.current_edition_id || book.display_edition_id || null, p_total_pages: book.total_pages ? Number(book.total_pages) : null }); closeModal(); toast(`${item.title} is now your current read.`); window.dispatchEvent(new CustomEvent('reading-room:refresh')); } catch (error) { toast(error.message || 'Could not start this book', true); event.currentTarget.disabled = false; } });
}

export function openUpNextManager(mutate) {
  const root = showModal(`<div class="upnext-manager-head"><div><p class="eyebrow">Reading queue</p><h2 id="upnext-manager-title">Manage Up Next</h2></div><button class="btn" type="button" data-close>Done</button></div><p class="upnext-manager-note">Locked items are protected from future librarian reshuffles.</p><button class="btn" type="button" data-queue-refresh>Reconsider unlocked picks</button><div id="queue-manager-list"></div><form id="upnext-add-form" class="upnext-add-form"><label for="upnext-add-book">Add a book manually</label><select id="upnext-add-book" name="book" class="input"></select><button class="btn btn-primary" type="submit">Add to queue</button></form>`);
  const modal = root.querySelector('.modal');
  modal.classList.add('upnext-manager-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'upnext-manager-title');

  const list = modal.querySelector('#queue-manager-list');
  const form = modal.querySelector('#upnext-add-form');
  const select = form.elements.book;
  const add = form.querySelector('[type="submit"]');
  const refresh = modal.querySelector('[data-queue-refresh]');
  let queue = [];
  let busy = false;
  let rowsMarkup;
  let selectorMarkup;

  modal.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModal();
  });
  list.addEventListener('click', event => {
    const button = event.target.closest('button');
    const row = button?.closest('[data-queue-id]');
    if (busy || !row || button.disabled) return;
    const queue_id = row.dataset.queueId;
    if (button.hasAttribute('data-queue-lock')) {
      void mutate('lock', { queue_id, locked: button.dataset.queueLock === '1' });
    } else if (button.hasAttribute('data-queue-remove')) {
      void mutate('remove', { queue_id });
    } else if (button.hasAttribute('data-queue-move')) {
      const expected_queue_ids = queue.map(item => item.queue_id);
      const queue_ids = [...expected_queue_ids];
      const index = queue_ids.indexOf(queue_id);
      const next = index + (button.dataset.queueMove === 'up' ? -1 : 1);
      [queue_ids[index], queue_ids[next]] = [queue_ids[next], queue_ids[index]];
      void mutate('reorder', { queue_ids, expected_queue_ids });
    }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!busy && select.value) {
      const selected = select.value;
      void mutate('add', { book_id: selected }).then(success => {
        if (!success && !select.disabled) select.value = selected;
      });
    }
  });
  refresh.addEventListener('click', () => { if (!busy) void mutate('refresh', {}); });

  return {
    get isOpen() { return modal.isConnected; },
    update(items, books, pending) {
      if (!modal.isConnected) return;
      queue = items;
      busy = pending;
      const scrollTop = modal.scrollTop;
      const backdrop = modal.parentElement;
      const backdropTop = backdrop.scrollTop;
      const rows = upNextManagerRows(queue);
      if (rows !== rowsMarkup) {
        const active = document.activeElement;
        const activeRow = active?.closest('[data-queue-id]');
        const action = ['data-queue-move', 'data-queue-lock', 'data-queue-remove'].find(name => active?.hasAttribute(name));
        list.innerHTML = rows;
        rowsMarkup = rows;
        if (activeRow && action) {
          const replacement = [...list.children].find(row => row.dataset.queueId === activeRow.dataset.queueId);
          const target = [...(replacement?.querySelectorAll(`[${action}]`) || [])].find(button => !button.disabled &&
            (action !== 'data-queue-move' || button.dataset.queueMove === active.dataset.queueMove));
          target?.focus({ preventScroll: true });
        }
      }
      list.querySelectorAll('button:not(:disabled)').forEach(button => button.setAttribute('aria-disabled', String(busy)));
      const ids = new Set(queue.map(item => item.id));
      const remaining = books.filter(book => canQueueBook(book) && !ids.has(book.id));
      const options = `<option value="">${remaining.length ? 'Choose a book…' : 'No eligible books available'}</option>${remaining.map(book => `<option value="${esc(book.id)}">${esc(book.title)} — ${esc(book.authors || '')}</option>`).join('')}`;
      if (options !== selectorMarkup) {
        const selection = select.value;
        select.innerHTML = options;
        select.value = remaining.some(book => book.id === selection) ? selection : '';
        selectorMarkup = options;
      }
      add.disabled = select.disabled = busy || !remaining.length;
      refresh.disabled = busy;
      modal.setAttribute('aria-busy', String(busy));
      backdrop.scrollTop = backdropTop;
      modal.scrollTop = scrollTop;
    }
  };
}

export function openRecommendation(item) {
  const root = showModal(`<div class="recommended-detail-shell"><button class="recommended-detail-close" type="button" data-close aria-label="Close">×</button><div class="recommended-detail-head">${cover(item, 'recommended-detail-cover')}<div class="recommended-detail-meta"><span class="recommended-badge ${item.recommendation_strength === 'Wildcard' ? 'wildcard' : ''}">${esc(item.recommendation_strength || 'Recommended')}</span><h2>${esc(item.title)}</h2><p class="recommended-detail-author">${esc(item.authors || 'Unknown author')}</p>${item.match_score_10 != null ? `<p class="recommended-detail-score">Match ${Number(item.match_score_10).toFixed(1)}/10</p>` : ''}</div></div><div class="recommended-detail-reason"><h3>Why I’m recommending it</h3><p>${esc(item.why_recommended || 'Recommended from your current Taste Profile and reading feedback.')}</p></div><div class="recommended-detail-actions"><button class="btn btn-primary" data-recommend-wishlist>Add to wish list</button></div></div>`, 'recommended-detail-backdrop');
  root.querySelector('[data-recommend-wishlist]').addEventListener('click', async event => { event.currentTarget.disabled = true; try { await rpc('recommendation_add_to_wishlist', { p_recommendation_id: item.recommendation_id }); closeModal(); toast(`${item.title} added to your wish list.`); window.dispatchEvent(new CustomEvent('reading-room:refresh')); } catch (error) { toast(error.message || 'Could not add this book', true); event.currentTarget.disabled = false; } });
}
