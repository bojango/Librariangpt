import { invoke, rpc } from '../data/library.js';
import { cover, esc } from '../ui/format.js';
import { closeModal, showModal, toast } from '../ui/feedback.js';
import { excludeSeriesFromAuthor, relatedDiscoveryKey, relatedStatus } from '../utils/related-books.js';

function statusBadge(item) {
  const status = relatedStatus(item);
  return `<span title="${esc(status.label)}" aria-label="${esc(status.label)}" style="position:absolute;right:7px;top:7px;z-index:4;display:grid;place-items:center;width:27px;height:27px;border:1px solid rgba(17,16,15,.28);background:rgba(241,238,229,.94);color:#171512;font:700 16px/1 system-ui;border-radius:999px;box-shadow:0 2px 8px rgba(0,0,0,.16)">${esc(status.icon)}</span>`;
}

function card(item) {
  const isExternal = item.kind === 'external';
  const attrs = isExternal
    ? `data-related-external="${esc(relatedDiscoveryKey(item))}" tabindex="0" role="button" aria-label="View ${esc(item.title)}"`
    : `data-open-book="${esc(item.book_id || item.id)}" tabindex="0" role="button" aria-label="Open ${esc(item.title)}"`;
  return `<article class="book-card" ${attrs}><div style="position:relative">${cover(item)}${statusBadge(item)}</div><div class="book-title">${esc(item.title)}</div><div class="book-author">${esc(item.authors || item.author || 'Unknown author')}</div></article>`;
}

function shelf(title, note, items) {
  if (!items?.length) return '';
  return `<section class="section" style="margin-top:34px"><div class="section-header"><div><h2>${esc(title)}</h2>${note ? `<p style="margin:5px 0 0;color:var(--muted);font-size:12px">${esc(note)}</p>` : ''}</div></div><div class="shelf">${items.map(card).join('')}</div></section>`;
}

function discoveryModal(item, originBookId) {
  const root = showModal(`<div class="recommended-detail-shell"><button class="recommended-detail-close" type="button" data-close aria-label="Close">×</button><div class="recommended-detail-head">${cover(item, 'recommended-detail-cover')}<div class="recommended-detail-meta"><span class="recommended-badge">${item.relationship === 'series' ? 'Series discovery' : 'Author discovery'}</span><h2>${esc(item.title)}</h2><p class="recommended-detail-author">${esc(item.authors || item.author || 'Unknown author')}</p>${item.publication_year ? `<p class="recommended-detail-score">First published ${esc(item.publication_year)}</p>` : ''}</div></div><div class="recommended-detail-reason"><h3>Synopsis</h3><p>${esc(item.synopsis || 'Synopsis not available yet.')}</p></div><div class="recommended-detail-actions"><button class="btn btn-primary" data-related-wishlist>Add to wish list</button></div></div>`, 'recommended-detail-backdrop');
  root.querySelector('[data-related-wishlist]').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await rpc('library_add_related_result', {
        p_result: item.add_payload || item,
        p_series_name: item.relationship === 'series' ? item.series_name || null : null,
        p_series_order: item.relationship === 'series' && item.series_order != null ? Number(item.series_order) : null
      });
      closeModal();
      toast(result?.already_in_library ? `${item.title} is already in Reading Room.` : `${item.title} added to your wish list.`);
      if (result?.book_id) queueMicrotask(() => invoke('book-background-enrich', { book_id: result.book_id }).catch(() => {}));
      window.dispatchEvent(new CustomEvent('reading-room:refresh', { detail: { scope: 'book', bookId: originBookId } }));
    } catch (error) {
      toast(error.message || 'Could not add this book to your wish list', true);
      button.disabled = false;
    }
  });
}

class RelatedBooksElement extends HTMLElement {
  #request = 0;

  connectedCallback() {
    this.style.display = 'block';
    this.load();
  }

  async load() {
    const bookId = this.dataset.bookId;
    if (!bookId) return;
    const request = ++this.#request;
    this.innerHTML = '<div style="margin:34px 0;color:var(--muted);font-size:12px">Finding related books…</div>';
    try {
      const data = await invoke('related-books', { book_id: bookId });
      if (!this.isConnected || request !== this.#request || this.dataset.bookId !== bookId) return;
      const seriesBooks = data?.series?.books || [];
      const authorBooks = excludeSeriesFromAuthor(seriesBooks, data?.author?.books || []);
      const totalSeries = Number(data?.series?.total_books || (seriesBooks.length + 1));
      const currentOrder = data?.series?.current_order;
      const seriesNote = data?.series ? `Series${currentOrder != null ? ` · Book ${Number(currentOrder)}${totalSeries ? ` of ${totalSeries}` : ''}` : ''}` : '';
      const html = [
        data?.series ? shelf(data.series.name, seriesNote, seriesBooks) : '',
        data?.author ? shelf(`More by ${data.author.name}`, 'Other books by this author', authorBooks) : ''
      ].join('');
      this.innerHTML = html || '';
      const external = [...seriesBooks, ...authorBooks].filter(item => item.kind === 'external');
      const byId = new Map(external.map(item => [relatedDiscoveryKey(item), item]));
      this.querySelectorAll('[data-related-external]').forEach(node => {
        const open = () => discoveryModal(byId.get(node.dataset.relatedExternal), bookId);
        node.addEventListener('click', open);
        node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
      });
    } catch (error) {
      if (!this.isConnected || request !== this.#request) return;
      console.info('[Reading Room] related books unavailable:', error?.message || error);
      this.innerHTML = '';
    }
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('related-books')) customElements.define('related-books', RelatedBooksElement);

export function relatedBooksMarkup(book) {
  return `<related-books data-book-id="${esc(book.id)}"></related-books>`;
}
