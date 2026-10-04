import { escapeHtml as esc } from '../utils/text.js';

export function sessionBookPickerMarkup(books, { pending = false } = {}) {
  const eligible = books.filter(book => ['Currently Reading','Paused','Owned - Unread','Wishlist','Recommended'].includes(book.overall_status));
  const rank = book => book.overall_status === 'Currently Reading' ? 0 : book.overall_status === 'Paused' ? 1 : 2;
  eligible.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
  return `<h2>${pending ? 'Choose book for reading session' : 'Change book'}</h2><p>${pending ? 'The timer starts when you confirm your book.' : 'The elapsed time is kept. Starting page uses this book’s current progress.'} Selecting an unread or paused book starts or resumes its normal reading lifecycle.</p><div class="field"><label for="session-book-search">Search your library</label><input class="input" type="search" id="session-book-search" autocomplete="off"></div><div class="session-book-list">${eligible.map(book => `<button class="btn session-book-option" type="button" data-session-book="${esc(book.id)}" data-search="${esc(`${book.title} ${book.authors || ''}`.toLocaleLowerCase())}"><span>${esc(book.title)}</span><small>${esc(book.authors || '')} · ${esc(book.overall_status)}</small></button>`).join('') || '<p>No startable books. Add a book to your library first.</p>'}</div><p role="alert" data-session-picker-error></p><div class="modal-actions"><button class="btn" type="button" ${pending ? 'data-session-cancel' : 'data-close'}>${pending ? 'Cancel pending start' : 'Cancel'}</button></div>`;
}
export function attachSessionBookPicker(root, { select, cancel }) {
  root.querySelector('#session-book-search').addEventListener('input', event => {
    const term = event.target.value.trim().toLocaleLowerCase();
    root.querySelectorAll('[data-session-book]').forEach(button => { button.hidden = !button.dataset.search.includes(term); });
  });
  const run = async (operation) => {
    const buttons = [...root.querySelectorAll('button')]; buttons.forEach(button => { button.disabled = true; });
    try { await operation(); }
    catch (error) { root.querySelector('[data-session-picker-error]').textContent = error.message || 'Could not select this book.'; buttons.forEach(button => { button.disabled = false; }); }
  };
  root.querySelectorAll('[data-session-book]').forEach(button => button.addEventListener('click', () => run(() => select(button.dataset.sessionBook))));
  root.querySelector('[data-session-cancel]')?.addEventListener('click', () => run(cancel));
}
