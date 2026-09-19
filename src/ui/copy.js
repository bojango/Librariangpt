import { escapeHtml } from '../utils/text.js';

export const UI_COPY = Object.freeze({
  'nav.home': 'Home', 'nav.library': 'Library', 'nav.wishlist': 'Wishlist', 'nav.profile': 'Profile',
  'home.currentlyReading': 'Currently Reading', 'home.upNext': 'Up Next', 'home.recommended': 'Recommended for you', 'home.manage': 'Manage', 'home.seeMore': 'See more', 'home.updateProgress': 'Update progress', 'home.openBook': 'Open book',
  'library.title': 'Library', 'library.wishlist': 'Wishlist',
  'profile.title': 'Profile', 'profile.stats': 'Stats', 'profile.tasteProfile': 'Taste Profile', 'profile.history': 'History', 'profile.readingRecord': 'Reading Record', 'profile.strongSignals': 'Strong signals', 'profile.frictionSignals': 'Friction Signals', 'profile.completedReads': 'Completed reads',
  'book.back': 'Back', 'book.synopsis': 'Synopsis', 'book.librarianNote': 'Librarian Note', 'book.yourReview': 'Your review', 'book.whyRecommended': 'Why it was recommended', 'book.progress': 'Progress'
});

let overrides = {};

export function setCopyOverrides(next) { overrides = next && typeof next === 'object' ? next : {}; }
export function uiCopy(key, fallback = UI_COPY[key] || '') {
  const value = String(overrides[key] ?? '').trim();
  return value || fallback || UI_COPY[key] || '';
}
export function uiCopyHtml(key, fallback) { return escapeHtml(uiCopy(key, fallback)); }
