import { chrome } from '../ui/chrome.js';
import { cover, esc, progressPct, progressText, readingAgeText } from '../ui/format.js';
import { currentTitlePresentation } from '../utils/text.js';

function bookCard(book) {
  return `<article class="book-card" data-open-book="${book.id}" tabindex="0" role="button" aria-label="Open ${esc(book.title)}">${cover(book)}<div class="book-title">${esc(book.title)}</div><div class="book-author">${esc(book.authors || 'Unknown author')}</div></article>`;
}

function shelf(title, books, route = '') {
  return `<section class="section"><div class="section-header"><h2>${esc(title)}</h2>${route ? `<button data-route="${route}">View all</button>` : ''}</div>${books.length ? `<div class="shelf">${books.map(bookCard).join('')}</div>` : '<div class="empty-shelf">Nothing here yet.</div>'}</section>`;
}

function chapterFor(state, bookId) {
  const row = state.chapters.find(item => item.id === bookId);
  if (!row) return '';
  const number = String(row.current_chapter_number || '').trim();
  const title = String(row.current_chapter_title || '').trim();
  if (!number && !title) return '';
  return title && number && title.toLowerCase() !== `chapter ${number}`.toLowerCase() ? `Chapter ${number}: ${title}` : title || `Chapter ${number}`;
}

function currentCard(book, state, index) {
  const pct = progressPct(book);
  const chapter = chapterFor(state, book.id);
  const title = currentTitlePresentation(book.title);
  const readingAge = readingAgeText(book.started_at);
  return `<section class="hero current-reading-card-v36" data-current-card="${book.id}" data-open-book="${book.id}">${cover(book, '', { eager: index === 0, high: index === 0 })}<div class="hero-copy"><p class="eyebrow">Currently reading</p><h1${title.className ? ` class="${title.className}" data-title-variant="${title.className.replace('current-title-', '').replace('-v37', '')}" style="${title.style}"` : ''}>${esc(book.title)}</h1><div class="hero-author">${esc(book.authors || '')}${readingAge ? ` <small>· ${esc(readingAge)}</small>` : ''}</div><div class="progress-block"><div class="progress-meta"><span>${esc(progressText(book))}</span><span>${book.total_pages ? `${Math.round(pct)}%` : ''}</span></div>${chapter ? `<div class="chapter-progress-line">${esc(chapter)}</div>` : ''}<div class="progress-track"><div class="progress-fill" style="--progress:${pct}%"></div></div></div><div class="hero-actions"><button class="btn btn-primary" data-progress="${book.id}">Update progress</button><button class="btn" data-open-book="${book.id}">Open book</button></div></div></section>`;
}

function currentReading(state) {
  const books = state.books.filter(book => book.overall_status === 'Currently Reading');
  if (!books.length) return `<section class="hero"><div class="hero-copy"><p class="eyebrow">Reading terminal</p><h1>Nothing currently open.</h1><div class="hero-author">Your owned-unread shelf is sitting there, judging with remarkable restraint.</div><div class="hero-actions"><button class="btn btn-primary" data-route="library">Browse library</button></div></div></section>`;
  return `<div class="current-reading-carousel-v36" data-carousel><div class="current-reading-track-v36" aria-label="Currently reading books">${books.map((book, index) => currentCard(book, state, index)).join('')}</div><div class="current-reading-dots-v36"><div class="current-reading-dot-rail-v36">${books.map((book, index) => `<button class="current-reading-dot-v36" data-carousel-dot="${index}" aria-label="Show ${esc(book.title)}"></button>`).join('')}<span class="current-reading-indicator-v36" aria-hidden="true"></span></div></div></div>`;
}

function upNextCard(item) {
  return `<article class="upnext-card" data-upnext-id="${item.queue_id || item.id}" tabindex="0" role="button">${cover(item, 'upnext-cover')}<div class="upnext-copy"><div class="upnext-position">${item.position}</div><div class="upnext-card-main"><p class="upnext-source ${item.source === 'Manual' ? 'manual' : 'ai'}">${item.source === 'Manual' ? 'Your pick' : 'Librarian pick'}${item.locked ? ' · locked' : ''}</p><h3>${esc(item.title)}</h3><p class="upnext-author">${esc(item.authors || 'Unknown author')}</p>${item.ai_score != null ? `<p class="upnext-score">${Number(item.ai_score).toFixed(1)}/10 · ${esc(item.confidence || '')} confidence</p>` : ''}<p class="upnext-reason">${esc(item.reason || item.why_recommended || 'Queued for later.')}</p></div></div></article>`;
}

function upNext(state) {
  return `<section class="section up-next-section" id="up-next-section"><div class="section-header"><h2>Up Next</h2><button class="upnext-manage" data-manage-upnext type="button">Manage</button></div>${state.upNext.length ? `<div class="upnext-row">${state.upNext.map(upNextCard).join('')}</div>` : '<div class="empty-shelf">Nothing queued yet.</div>'}</section>`;
}

function recommendationCard(item) {
  return `<article class="recommended-card ${item.recommendation_strength === 'Wildcard' ? 'is-wildcard' : ''}" data-recommendation-id="${item.recommendation_id}" tabindex="0" role="button">${cover(item, 'recommended-cover')}<div class="recommended-copy"><div class="recommended-card-top"><span class="recommended-badge ${item.recommendation_strength === 'Wildcard' ? 'wildcard' : ''}">${esc(item.recommendation_strength || 'Recommended')}</span>${item.match_score_10 != null ? `<span class="recommended-card-score">${Number(item.match_score_10).toFixed(1)}</span>` : ''}</div><h3>${esc(item.title)}</h3><p class="recommended-author">${esc(item.authors || 'Unknown author')}</p><p class="recommended-reason">${esc(item.why_recommended || 'Recommended from your current Taste Profile and reading feedback.')}</p></div></article>`;
}

function recommendations(state) {
  const chosen = state.aiRecommendations.filter(item => item.frontend_featured);
  const picks = (chosen.length ? chosen : state.aiRecommendations).slice(0, 5);
  return `<section class="section ai-recommended-section" id="ai-recommended-section"><div class="section-header"><div><h2>Recommended for you</h2><p class="recommended-section-note">AI picks from beyond your library, shaped by what you actually enjoy.</p></div><button class="recommended-more" data-recommendations-page type="button" ${state.aiRecommendations.length ? '' : 'disabled'}>See more</button></div>${picks.length ? `<div class="recommended-row">${picks.map(recommendationCard).join('')}</div>` : '<div class="empty-shelf">No active recommendations right now.</div>'}</section>`;
}

export function homeView(state) {
  const unread = state.books.filter(book => book.overall_status === 'Owned - Unread').slice(0, 12);
  const wishlist = state.books.filter(book => book.overall_status === 'Wishlist').slice(0, 12);
  const recent = state.books.filter(book => book.overall_status === 'Read').sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0)).slice(0, 12);
  return chrome(`${currentReading(state)}${upNext(state)}${recommendations(state)}${shelf('Owned & unread', unread, 'library')}${shelf('Wishlist', wishlist, 'wishlist')}${shelf('Recently finished', recent, 'library')}`, 'home');
}
