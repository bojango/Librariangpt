import { chrome } from '../ui/chrome.js';

export function statsView(state) {
  const read = state.books.filter(book => book.overall_status === 'Read');
  const year = new Date().getFullYear();
  const ratings = read.map(book => Number(book.user_rating_5)).filter(Number.isFinite);
  const average = ratings.length ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : '—';
  const pages = read.reduce((sum, book) => sum + (Number(book.total_pages) || 0), 0);
  const stat = (value, label, wide = false) => `<div class="stat ${wide ? 'stat-wide' : ''}"><strong>${value}</strong><span>${label}</span></div>`;
  return chrome(`<div class="page-heading"><p class="eyebrow">Reading data</p><h1>Stats</h1><p>Useful numbers, generated without requiring you to maintain a spreadsheet like it is 2007.</p></div><div class="stats-grid">${stat(read.length, 'Books read')}${stat(read.filter(book => book.completed_at && new Date(book.completed_at).getFullYear() === year).length, `Finished in ${year}`)}${stat(state.books.filter(book => book.overall_status === 'Currently Reading').length, 'Currently reading')}${stat(state.books.filter(book => book.overall_status === 'Owned - Unread').length, 'Owned & unread')}${stat(state.books.filter(book => book.overall_status === 'Wishlist').length, 'Wishlist')}${stat(average, 'Average rating')}${stat(pages ? pages.toLocaleString('en-GB') : '—', 'Known pages across completed books', true)}</div>`, 'stats');
}
