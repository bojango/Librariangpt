import { chrome } from '../ui/chrome.js';
import { uiCopyHtml } from '../ui/copy.js';
import { durationCompact, profileReadingTime } from '../utils/reading-time.js';
import { tasteIdentity } from '../features/taste-identity.js';
import { feedTab } from '../features/activity-feed.js';
import { readingDurationText } from '../ui/format.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

function firstName(value) {
  const cleaned = String(value || '').trim().replace(/[^\p{L}\p{N}' -]/gu, '');
  return cleaned ? cleaned.split(/\s+/)[0] : '';
}

function readerIdentity(state) {
  const metadata = state.session?.user?.user_metadata || {};
  const displayName = state.profile?.display_name || metadata.full_name || metadata.name || metadata.display_name || metadata.user_name || '';
  const name = firstName(displayName);
  const handle = state.profile?.handle || (metadata.user_name ? `@${String(metadata.user_name).replace(/^@/, '')}` : 'PRIVATE READER');
  return { displayName: displayName || 'Reader', name: name || 'The reader', handle };
}

function formatDate(value, fallback = 'Date not recorded') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function profileImage(profile, identity) {
  if (profile?.avatarUrl) return `<img src="${escapeHtml(profile.avatarUrl)}" alt="${escapeHtml(identity.displayName)}'s profile photo">`;
  return `<span class="profile-avatar-placeholder" aria-hidden="true">${escapeHtml((identity.displayName || 'R').slice(0, 1).toUpperCase())}</span><span class="sr-only">No profile photo uploaded</span>`;
}

export function profilePhotoActionsMarkup() {
  return `<div class="profile-photo-actions"><p class="eyebrow">Profile photo</p><h2>Photo</h2><button class="btn btn-primary btn-full" type="button" data-avatar-change>Change photo</button><button class="btn btn-full" type="button" data-close>Cancel</button></div>`;
}

export function profileEditMarkup(profile = {}, metadata = {}) {
  const displayName = profile.display_name || metadata.full_name || metadata.name || metadata.display_name || '';
  const handle = profile.handle || (metadata.user_name ? `@${String(metadata.user_name).replace(/^@/, '')}` : '');
  return `<form id="profile-edit-form" class="form-stack profile-edit-form"><div><p class="eyebrow">Private reader profile</p><h2>Edit profile</h2></div><div class="field"><label for="profile-display-name">Display name</label><input class="input" id="profile-display-name" name="display-name" maxlength="80" value="${escapeHtml(displayName)}" required></div><div class="field"><label for="profile-handle">Handle</label><input class="input" id="profile-handle" name="handle" maxlength="80" value="${escapeHtml(handle)}" required></div><div class="field"><label for="profile-short-bio">Short bio</label><textarea class="input" id="profile-short-bio" name="short-bio" maxlength="280" rows="4">${escapeHtml(profile.short_bio || '')}</textarea></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save profile</button></div></form>`;
}

function statRows(state) {
  const read = state.books.filter(book => book.overall_status === 'Read');
  const ratings = read.filter(book => book.user_rating_5 != null).map(book => Number(book.user_rating_5)).filter(Number.isFinite);
  const totalPages = read.reduce((sum, book) => sum + (Number(book.total_pages) || 0), 0);
  const year = new Date().getFullYear();
  const values = [
    ['BOOKS READ', read.length],
    [`READ THIS YEAR`, read.filter(book => book.completed_at && new Date(book.completed_at).getFullYear() === year).length],
    ['CURRENTLY READING', state.books.filter(book => book.overall_status === 'Currently Reading').length],
    ['OWNED / UNREAD', state.books.filter(book => book.overall_status === 'Owned - Unread').length],
    ['WISHLIST', state.books.filter(book => book.overall_status === 'Wishlist').length],
    ['AVERAGE RATING', ratings.length ? (ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(1) : '—']
  ];
  if (totalPages) values.push(['KNOWN PAGES READ', totalPages.toLocaleString('en-GB')]);
  const time = profileReadingTime(state.readingTimeSessions);
  const timeValue = seconds => state.readingTimeSessions == null ? '—' : durationCompact(seconds);
  values.push(
    ['READING TIME THIS YEAR', timeValue(time.yearSeconds)],
    ['TOTAL READING TIME', timeValue(time.totalSeconds)],
    ['AVG READING DAY', timeValue(time.averageDaySeconds)],
    ['AVG SESSION', timeValue(time.averageSessionSeconds)]
  );
  return values.map(([label, value]) => `<div class="profile-stat-row"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function tasteTab(state, identity) {
  const taste = tasteIdentity(state.tasteProfile || [], state.books);
  const signals = (items, empty) => items.length ? items.map(signal => {
    const evidence = (signal.taste_evidence || []).filter(e => e.book || state.books.some(b => b.id === e.book_id));
    return `<article class="taste-signal"><h4>${escapeHtml(signal.dimension)}</h4><p>${escapeHtml(signal.preference)}</p><small>${escapeHtml(`${signal.direction} · ${signal.strength} · ${signal.confidence} confidence · ${signal.evidence_count} evidence records`)}</small>${evidence.length ? `<ul class="taste-book-evidence">${evidence.map(e => {
      const book = e.book || state.books.find(b => b.id === e.book_id);
      const owned = state.books.some(b => b.id === e.book_id);
      return `<li>${owned ? `<a href="#/book/${encodeURIComponent(e.book_id)}" data-open-book="${escapeHtml(e.book_id)}">${escapeHtml(book.title)}</a>` : escapeHtml(book.title)} <small>· ${escapeHtml(e.relation)}${e.weight != null ? ` · weight ${escapeHtml(e.weight)}` : ''}</small></li>`;
    }).join('')}</ul>` : ''}</article>`;
  }).join('') : `<p class="profile-empty-copy">${empty}</p>`;
  return `<section class="profile-tab-content" id="profile-panel-taste" role="tabpanel" aria-labelledby="profile-tab-taste" tabindex="0"><section class="taste-overview"><h2>Overview</h2><p>${escapeHtml(taste.summary)}</p></section><div class="taste-details-sections"><section><h3>Strong Signals</h3>${signals(taste.strong, 'No reliable positive signals yet.')}</section><section><h3>Friction Signals</h3>${signals(taste.friction, 'No reliable negative or mixed signals yet.')}</section><section><h3>Emerging Signals</h3>${signals(taste.emerging, 'No tentative signals recorded.')}</section></div><p class="taste-updated">Last updated · ${escapeHtml(formatDate(taste.updated, 'Not yet recorded'))}</p></section>`;
}

function historyEvents(state) {
  const books = new Map(state.books.map(book => [book.id, book]));
  const sessions = (state.readingHistory || []).map(session => ({ ...session, book: books.get(session.book_id), eventType: 'session', completion: session.completed_at }));
  const sessionBookIds = new Set(sessions.map(session => session.book_id));
  const fallback = state.books.filter(book => book.overall_status === 'Read' && !sessionBookIds.has(book.id)).map(book => ({ id: `fallback-${book.id}`, book_id: book.id, book, started_at: book.started_at, completion: book.completed_at, user_rating_5: book.user_rating_5, format_read: book.format, eventType: 'fallback' }));
  return [...sessions, ...fallback].filter(event => event.book).sort((left, right) => {
    const rightDate = right.completion ? new Date(right.completion).getTime() : -Infinity;
    const leftDate = left.completion ? new Date(left.completion).getTime() : -Infinity;
    return rightDate - leftDate;
  });
}

function historyItem(event) {
  const book = event.book;
  const cover = book.cover_url ? `<img src="${escapeHtml(book.cover_url)}" alt="">` : `<span aria-hidden="true">BOOK</span>`;
  const rating = event.user_rating_5 != null ? Number(event.user_rating_5) : NaN;
  const validDates = event.started_at && event.completion && new Date(event.completion) >= new Date(event.started_at);
  const metadata = [`Started ${formatDate(event.started_at, 'not recorded')}`, `Finished ${formatDate(event.completion, 'not recorded')}`, validDates ? readingDurationText(event.started_at, event.completion) : 'Duration not recorded', Number.isFinite(rating) ? `${rating.toFixed(1)} / 5` : 'Unrated', book.primary_genre || 'Genre not recorded'].filter(Boolean);
  return `<button class="profile-history-item" data-open-book="${escapeHtml(book.id)}" aria-label="Open ${escapeHtml(book.title)}"><span class="profile-history-cover">${cover}</span><span class="profile-history-copy"><strong>${escapeHtml(book.title)}</strong><span>${escapeHtml(book.authors || 'Author not recorded')}</span><small>${escapeHtml(metadata.join(' · '))}</small></span></button>`;
}

function historyTab(state) {
  const events = historyEvents(state);
  const groups = new Map();
  events.forEach(event => {
    const year = event.completion && !Number.isNaN(new Date(event.completion).getTime()) ? String(new Date(event.completion).getFullYear()) : 'DATE NOT RECORDED';
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(event);
  });
  const markup = [...groups].map(([year, items]) => `<section class="history-year"><h3>${year}</h3><div class="profile-history-list">${items.map(historyItem).join('')}</div></section>`).join('');
  return `<section class="profile-tab-content" id="profile-panel-history" role="tabpanel" aria-labelledby="profile-tab-history" tabindex="0">${markup || '<p class="profile-empty">No completed reads have been recorded yet.</p>'}</section>`;
}

function statsTab(state) {
  return `<section class="profile-tab-content" id="profile-panel-stats" role="tabpanel" aria-labelledby="profile-tab-stats" tabindex="0"><div class="profile-section-heading"><p class="eyebrow">Canonical library data</p><h2>${uiCopyHtml('profile.readingRecord')}</h2><p>A concise record of the current collection and completed reading.</p></div><div class="profile-stat-record">${statRows(state)}</div></section>`;
}

export function profileView(state) {
  const identity = readerIdentity(state);
  const taste = tasteIdentity(state.tasteProfile || [], state.books);
  const tab = ['feed', 'stats', 'taste', 'history'].includes(state.profileTab) ? state.profileTab : 'feed';
  const tabs = [['feed', 'Feed'], ['stats', uiCopyHtml('profile.stats')], ['taste', uiCopyHtml('profile.tasteProfile')], ['history', uiCopyHtml('profile.history')]];
  const content = tab === 'taste' ? tasteTab(state, identity) : tab === 'history' ? historyTab(state) : tab === 'stats' ? statsTab(state) : feedTab(state);
  const avatarLabel = state.profile?.avatar_path ? 'Change profile photo' : 'Upload profile photo';
  const stats = [['Books Read', 'Read'], ['Currently Reading', 'Currently Reading'], ['Wishlist', 'Wishlist']];
  return chrome(`<div class="profile-page"><header class="profile-page-title"><p class="eyebrow">Private reader profile</p><h1>${uiCopyHtml('profile.title')}</h1></header><section class="profile-card"><span class="profile-display-id">#0001</span><button class="profile-avatar" type="button" data-avatar-menu aria-label="${avatarLabel}">${profileImage(state.profile, identity)}</button><div class="profile-identity"><span class="profile-private">PRIVATE</span><h2><button type="button" class="profile-inline-identity" data-identity-edit aria-label="Edit username and identity">${escapeHtml(identity.handle)}</button></h2><p class="profile-genres">${escapeHtml(taste.genres.join(' / '))}</p></div><div class="profile-card-summary"><p id="profile-summary" class="profile-bio is-collapsed">${escapeHtml(taste.summary)}</p><button class="inline-expand" type="button" data-expand="profile-summary" aria-controls="profile-summary" aria-expanded="false">See more</button></div><div class="profile-card-stats">${stats.map(([label,status]) => `<div><strong>${state.books.filter(b => b.overall_status === status).length}</strong><span>${label}</span></div>`).join('')}</div></section><label class="sr-only" for="profile-avatar-input">${avatarLabel}</label><input class="sr-only" id="profile-avatar-input" type="file" data-avatar-input accept="image/jpeg,image/png,image/webp"><div class="profile-tabs" role="tablist" aria-label="Profile sections">${tabs.map(([key, label]) => `<button id="profile-tab-${key}" type="button" role="tab" data-profile-tab="${key}" aria-controls="profile-panel-${key}" aria-selected="${String(tab === key)}" tabindex="${tab === key ? '0' : '-1'}" class="${tab === key ? 'active' : ''}">${label}</button>`).join('')}</div>${content}</div>`, 'profile');
}
