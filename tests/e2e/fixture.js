import { homeView } from '../../src/views/home.js';
import { libraryView } from '../../src/views/library.js';
import { bookDetailView } from '../../src/views/book-detail.js';
import { statsView } from '../../src/views/stats.js';

const books = [
  { id: 'current-1', title: 'Currently One', authors: 'Reader One', overall_status: 'Currently Reading', ownership_status: 'Owned', current_page: 40, total_pages: 200, progress_percent: 20, cover_url: '/missing-cover.jpg', primary_genre: 'Fiction' },
  { id: 'current-2', title: 'Currently Two', authors: 'Reader Two', overall_status: 'Currently Reading', ownership_status: 'Owned', current_page: 90, total_pages: 300, progress_percent: 30, primary_genre: 'History' },
  { id: 'read-1', title: 'Finished Book', authors: 'Done Author', overall_status: 'Read', ownership_status: 'Owned', total_pages: 250, user_rating_5: 4.5, synopsis: 'A complete synopsis for fixture rendering.', primary_genre: 'Science' },
  { id: 'wish-1', title: 'Wish Book', authors: 'Future Author', overall_status: 'Wishlist', ownership_status: 'Not Owned', primary_genre: 'Essay' }
];
const state = {
  session: { user: { id: 'fixture' } }, books, recommendations: [],
  aiRecommendations: [{ recommendation_id: 'rec-1', title: 'Outside Pick', authors: 'AI Author', recommendation_strength: 'Strong', match_score_10: 8.8, why_recommended: 'A fixture recommendation.' }],
  upNext: [{ queue_id: 'queue-1', id: 'wish-1', title: 'Wish Book', authors: 'Future Author', position: 1, source: 'Manual', locked: true }],
  chapters: [{ id: 'current-1', current_chapter_number: '3', current_chapter_title: 'The Middle' }],
  filters: { library: 'All', wishlist: 'Wishlist' }, queries: { library: '', wishlist: '' }, route: { name: 'home' }, detail: null
};
const app = document.querySelector('#app');

function detailFor(book) {
  return { book, ratings: [{ provider: 'Open Library', rating_5: 4.2, rating_count: 1200, is_primary: true }], recommendation: null, quotes: [{ id: 'q1', page_start: 12, quote_text: 'A saved passage.', note: 'Fixture note' }], editions: [], enrichment: {} };
}

function render() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('book/')) { const book = books.find(item => item.id === decodeURIComponent(hash.slice(5))); state.route = { name: 'book', bookId: book.id, returnTo: 'library' }; state.detail = detailFor(book); app.innerHTML = bookDetailView(state); return; }
  const name = ['library', 'wishlist', 'stats'].includes(hash) ? hash : 'home'; state.route = { name };
  app.innerHTML = name === 'home' ? homeView(state) : name === 'stats' ? statsView(state) : libraryView(state, name);
}

app.addEventListener('click', event => {
  const route = event.target.closest('[data-route]'); if (route) { location.hash = `#/${route.dataset.route}`; return; }
  const filter = event.target.closest('[data-filter]'); if (filter) { state.filters.library = filter.dataset.filter; render(); return; }
  const book = event.target.closest('[data-open-book]'); if (book) { location.hash = `#/book/${book.dataset.openBook}`; return; }
  if (event.target.closest('[data-back]')) location.hash = '#/library';
});
window.addEventListener('hashchange', render);
render();
