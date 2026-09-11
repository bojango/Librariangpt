import { invoke, rpc, searchBooks } from '../data/library.js';
import { esc } from '../ui/format.js';
import { closeModal, showModal, toast } from '../ui/feedback.js';

let adding = false;

export function openAddBook() {
  adding = false;
  const root = showModal(`<div class="add30-head"><h2>Add book</h2><p>Search, choose the exact result, then Reading Room saves core details immediately and enriches in the background.</p></div><form id="add-search" class="form-stack"><div class="add-mode-switch"><button type="button" class="active" data-mode="title">Title</button><button type="button" data-mode="isbn">ISBN</button></div><div data-fields="title"><div class="field"><label for="add-title">Book title</label><input class="input" id="add-title" name="title" required></div><div class="field"><label for="add-author">Author <span class="field-optional">optional</span></label><input class="input" id="add-author" name="author"></div></div><div data-fields="isbn" hidden><div class="field"><label for="add-isbn">ISBN-10 or ISBN-13</label><input class="input" id="add-isbn" name="isbn" inputmode="numeric"></div></div><div class="field"><label for="add-state">Add as</label><select class="input" id="add-state" name="state"><option value="wishlist">Wishlist</option><option value="owned">Owned · unread</option></select></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Search</button></div></form>`, 'library-add-v30-backdrop');
  let mode = 'title';
  root.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { mode = button.dataset.mode; root.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('active', item === button)); root.querySelectorAll('[data-fields]').forEach(item => { item.hidden = item.dataset.fields !== mode; }); root.querySelector('[name="title"]').required = mode === 'title'; }));
  root.querySelector('#add-search').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const query = mode === 'isbn' ? event.currentTarget.isbn.value.trim() : event.currentTarget.title.value.trim();
      if (!query) throw new Error(`Enter ${mode === 'isbn' ? 'an ISBN' : 'a title'}.`);
      const context = { query, author: mode === 'title' ? event.currentTarget.author.value.trim() : '', mode, addAs: event.currentTarget.state.value };
      const results = await searchBooks(context); renderResults(context, results);
    } catch (error) { toast(error.message || 'Could not search for books', true); button.disabled = false; }
  });
}

function renderResults(context, results) {
  const root = showModal(`<div class="add30-head"><p class="admin-kicker">Search results</p><h2>Choose the correct book</h2><p>${results.length ? `${results.length} possible matches for “${esc(context.query)}”.` : `No reliable matches for “${esc(context.query)}”.`}</p></div>${results.length ? `<div class="add30-results">${results.map((result, index) => `<button type="button" class="add30-result ${result.already_in_library ? 'is-existing' : ''}" data-result="${index}" ${result.already_in_library ? 'disabled' : ''}><div class="add30-cover">${result.cover_url ? `<img src="${esc(result.cover_url)}" alt="" loading="eager">` : '<span>No cover</span>'}</div><div class="add30-result-copy"><div class="add30-result-title">${esc(result.title)}</div>${result.subtitle ? `<div class="add30-result-subtitle">${esc(result.subtitle)}</div>` : ''}<div class="add30-result-author">${esc((result.authors || []).join(', ') || 'Unknown author')}</div><div class="add30-result-meta">${esc([result.publication_year, result.publisher, result.page_count ? `${result.page_count} pages` : null, result.isbn13 || result.isbn10].filter(Boolean).join(' · '))}</div><div class="add30-result-source">${result.already_in_library ? 'Already in your library' : esc(result.provider || 'Catalogue result')}</div></div></button>`).join('')}</div>` : '<div class="add30-empty">Try the title with the author, or use an ISBN.</div>'}<div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn" type="button" data-search-again>Search again</button></div>`, 'library-add-v30-backdrop');
  root.querySelector('[data-search-again]').addEventListener('click', openAddBook);
  root.querySelectorAll('[data-result]').forEach(button => button.addEventListener('click', () => addSelected(context, results[Number(button.dataset.result)], button)));
}

async function addSelected(context, result, button) {
  if (adding || result.already_in_library) return; adding = true; button.disabled = true;
  const status = context.addAs === 'owned' ? 'Owned - Unread' : 'Wishlist'; const ownership = context.addAs === 'owned' ? 'Owned' : 'Not Owned';
  try {
    if (!result.isbn13 && !result.isbn10) throw new Error('That result has no usable ISBN. Choose another edition.');
    const data = await rpc('library_add_selected_result', { p_result: result, p_status: status, p_ownership: ownership });
    if (data?.already_in_library) throw new Error('That exact edition is already in your library.');
    closeModal(); toast(`${result.title} added. Metadata and editions will continue in the background.`); window.dispatchEvent(new CustomEvent('reading-room:refresh'));
    if (data?.book_id) queueMicrotask(() => invoke('book-background-enrich', { book_id: data.book_id }).catch(error => console.info('[Reading Room] background enrichment deferred:', error?.message || error)));
  } catch (error) { adding = false; button.disabled = false; toast(error.message || 'Could not add that book', true); }
}
