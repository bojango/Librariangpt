import { chrome } from '../ui/chrome.js';
import { cover, esc } from '../ui/format.js';

export const FILTERS = ['All', 'Owned', 'Unread', 'Read', 'Wishlist', 'Recommended'];

export function filteredBooks(state, routeName) {
  const query = state.queries[routeName] || '';
  const filter = routeName === 'wishlist' ? 'Wishlist' : state.filters.library;
  let books = [...state.books];
  if (query.trim()) {
    const term = query.trim().toLowerCase();
    books = books.filter(book => [book.title, book.authors, book.primary_genre, book.series].some(value => String(value || '').toLowerCase().includes(term)));
  }
  if (filter === 'Owned') books = books.filter(book => book.ownership_status === 'Owned');
  if (filter === 'Unread') books = books.filter(book => book.overall_status === 'Owned - Unread');
  if (filter === 'Read') books = books.filter(book => book.overall_status === 'Read');
  if (filter === 'Wishlist') books = books.filter(book => book.overall_status === 'Wishlist');
  if (filter === 'Recommended') {
    const ids = new Set(state.recommendations.filter(item => item.recommendation_status !== 'Dismissed').map(item => item.book_id));
    books = books.filter(book => ids.has(book.id));
  }
  return books.sort((a, b) => a.title.localeCompare(b.title));
}

function card(book, index) {
  return `<article class="book-card" data-open-book="${book.id}" tabindex="0" role="button" aria-label="Open ${esc(book.title)}">${cover(book, '', { eager: index < 6, high: index < 3 })}<div class="book-title">${esc(book.title)}</div><div class="book-author">${esc(book.authors || 'Unknown author')}</div></article>`;
}

export function libraryView(state, routeName) {
  const books = filteredBooks(state, routeName);
  const filter = routeName === 'wishlist' ? 'Wishlist' : state.filters.library;
  return chrome(`<div class="page-heading"><p class="eyebrow">Catalogue</p><h1>${routeName === 'wishlist' ? 'Wishlist' : filter === 'All' ? 'Library' : esc(filter)}</h1><p>${books.length} ${books.length === 1 ? 'book' : 'books'} in this view.</p></div><div class="toolbar"><button class="btn btn-primary" data-add-book type="button">Add book</button><input id="library-search" class="input search" data-library-search="${routeName}" type="search" placeholder="Search title, author, genre or series" value="${esc(state.queries[routeName] || '')}">${routeName === 'library' ? `<div class="filters">${FILTERS.map(item => `<button class="filter ${filter === item ? 'active' : ''}" data-filter="${item}">${item}</button>`).join('')}</div>` : ''}</div><div class="library-grid">${books.map(card).join('')}</div>`, routeName);
}
