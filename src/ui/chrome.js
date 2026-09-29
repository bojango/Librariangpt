import { uiCopyHtml } from './copy.js';
import { escapeHtml } from '../utils/text.js';

const PAGE_TITLES = Object.freeze({
  home: 'Home', library: 'Library', wishlist: 'Wishlist', profile: 'Profile',
  recommendations: 'Recommended', stats: 'Stats'
});

export function headerTitle(route, title) {
  if (route === 'book') return title || 'Book';
  return title || PAGE_TITLES[route] || String(route || 'Home').replace(/[-_]/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

export function greetingForHour(hour) {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function bookProgressPercent(book) {
  const recorded = book?.progress_percent;
  if (recorded != null && recorded !== '' && Number.isFinite(Number(recorded))) {
    return `${Math.round(Math.max(0, Math.min(100, Number(recorded))))}%`;
  }
  const current = Number(book?.current_page);
  const total = Number(book?.total_pages);
  if (book?.current_page != null && book?.total_pages != null && Number.isFinite(current) && Number.isFinite(total) && total > 0) {
    return `${Math.round(Math.max(0, Math.min(100, current / total * 100)))}%`;
  }
  return '';
}

export function bookHeaderSubtitle(book) {
  if (!book) return 'Book details';
  const status = String(book.overall_status || '').trim();
  const progress = bookProgressPercent(book);
  if (status === 'Currently Reading') return `Currently Reading${progress ? ` · ${progress}` : ''}`;
  if (status === 'Owned - Unread') return 'Owned · Unread';
  if (status === 'Wishlist') return 'Wishlist';
  if (status === 'Paused' || status === 'DNF') return `${status}${progress ? ` · ${progress}` : ''}`;
  if (status === 'Read') {
    const rating = book.user_rating_5;
    return rating != null && rating !== '' && Number.isFinite(Number(rating))
      ? `Read · ${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(Number(rating))}/5`
      : 'Read';
  }
  return status || String(book.ownership_status || '').trim() || 'Book details';
}

export function headerSubtitle(route, { book, wishlistCount, date = new Date() } = {}) {
  if (route === 'home') return greetingForHour(date.getHours());
  if (route === 'book') return bookHeaderSubtitle(book);
  if (route === 'wishlist') return Number.isInteger(wishlistCount) ? `${wishlistCount} ${wishlistCount === 1 ? 'book' : 'books'}` : 'Your wishlist';
  return { library: 'Your books', recommendations: 'Picked for you', profile: 'Your reading profile', stats: 'Your reading stats' }[route] || 'Reading Room';
}

export function refreshHeaderGreeting(doc = document, date = new Date()) {
  const greeting = greetingForHour(date.getHours());
  doc.querySelectorAll('.header-greeting').forEach(node => { node.textContent = greeting; });
}

export function installHeaderGreetingClock(doc = document, win = window) {
  let timer;
  const tick = () => {
    refreshHeaderGreeting(doc);
    timer = win.setTimeout(tick, 60000 - new Date().getSeconds() * 1000);
  };
  tick();
  doc.addEventListener('visibilitychange', () => { if (!doc.hidden) refreshHeaderGreeting(doc); });
  return () => win.clearTimeout(timer);
}

export function navigation(active) {
  const icons = {
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="nav-icon-outline" d="M3.5 10.5 12 3.75l8.5 6.75v9.25h-6v-6h-5v6h-6z"/><path class="nav-icon-solid" d="M12 2.5 2.5 10v11h8v-6h3v6h8V10z"/></svg>',
    library: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="nav-icon-outline" d="M4 4.25h4.5v15.5H4zM8.5 5.75H13v14H8.5zM14.25 4.75l4.1-1.1 3.75 14.9-4.1 1.1z"/><path class="nav-icon-solid" d="M3.25 3.5h5.5v17h-5.5zm5.5 1.5h5v15.5h-5zm5.1-.9 5.15-1.3 4.1 16.35-5.15 1.3z"/></svg>',
    wishlist: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="nav-icon-outline" d="M20.5 9.25c0 5.25-8.5 10-8.5 10s-8.5-4.75-8.5-10a4.75 4.75 0 0 1 8.5-2.9 4.75 4.75 0 0 1 8.5 2.9Z"/><path class="nav-icon-solid" d="M21.5 9.15C21.5 15 12 20.5 12 20.5S2.5 15 2.5 9.15A5.65 5.65 0 0 1 12 5a5.65 5.65 0 0 1 9.5 4.15Z"/></svg>',
    profile: '<svg viewBox="0 0 24 24" aria-hidden="true"><g class="nav-icon-outline"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 20c.8-3.6 3.3-5.5 7.5-5.5s6.7 1.9 7.5 5.5"/></g><g class="nav-icon-solid"><circle cx="12" cy="7.5" r="4"/><path d="M3.5 21c.75-4.65 3.6-7 8.5-7s7.75 2.35 8.5 7z"/></g></svg>'
  };
  const items = [['home',uiCopyHtml('nav.home')],['library',uiCopyHtml('nav.library')],['wishlist',uiCopyHtml('nav.wishlist')],['profile',uiCopyHtml('nav.profile')]];
  return `<nav class="bottom-nav" aria-label="Main navigation">${items.map(([key, label]) => `<button class="nav-btn ${active === key ? 'active' : ''}" data-route="${key}"${active === key ? ' aria-current="page"' : ''}><span class="nav-icon">${icons[key]}</span><span class="nav-label">${label}</span></button>`).join('')}<i class="nav-active-indicator" aria-hidden="true"></i></nav>`;
}

export function chrome(content, active, { route = active, title, book, wishlistCount } = {}) {
  const pageTitle = escapeHtml(headerTitle(route, title));
  const subtitle = escapeHtml(headerSubtitle(route, { book, wishlistCount }));
  return `<div class="layout"><div class="top-actions"><button class="icon-btn header-menu" data-menu aria-label="Open menu"><span class="menu-bars"><i></i><i></i><i></i></span></button></div><header class="topbar"><div class="header-meta"><div class="header-title" title="${pageTitle}">${pageTitle}</div><div class="header-subtitle${route === 'home' ? ' header-greeting' : ''}">${subtitle}</div></div><button class="header-brand" data-route="home" aria-label="Go to Reading Room home"><span class="brand-mark"><img src="./assets/reading-room-books.svg?v=98" alt=""></span></button></header><div class="pull-refresh-indicator" data-pull-refresh role="status" aria-live="polite"><span class="pull-refresh-icon" aria-hidden="true"><span class="pull-refresh-arrow">↓</span><span class="pull-refresh-spinner"></span></span><span class="pull-refresh-label">Pull to refresh</span></div><main>${content}</main>${navigation(active)}</div>`;
}
