import { chrome } from '../ui/chrome.js';
import { uiCopyHtml } from '../ui/copy.js';

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
  const ratings = read.map(book => Number(book.user_rating_5)).filter(Number.isFinite);
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
  return values.map(([label, value]) => `<div class="profile-stat-row"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function signalRank(signal) {
  const strength = { Strong: 30, Moderate: 18, Weak: 7 }[signal.strength] || 0;
  const confidence = { High: 12, Medium: 7, Low: 2 }[signal.confidence] || 0;
  const evidence = Math.min(Number(signal.evidence_count) || 0, 10);
  const direction = signal.direction === 'Negative' || signal.direction === 'Mixed' ? 3 : 0;
  return strength + confidence + evidence + direction;
}

function preferencePhrase(value) {
  return String(value || '').trim().replace(/[.]+$/, '');
}

function compactPreference(value, limit = 360) {
  const text = preferencePhrase(value);
  if (text.length <= limit) return text;
  const boundary = text.lastIndexOf(' ', limit - 1);
  return `${text.slice(0, boundary > 80 ? boundary : limit).trim()}…`;
}

function dimensionLabel(signal) {
  return String(signal.dimension || 'this area of taste').trim() || 'this area of taste';
}

function thirdPersonPreference(signal, name, fallback = 'Evidence around {dimension} is consistent') {
  const preference = compactPreference(signal.preference);
  const directPatterns = [
    [/^strongly\s+prefers?\s+(.+)/i, (_, rest) => `${name} strongly prefers ${rest}`],
    [/^strongly\s+enjoys?\s+(.+)/i, (_, rest) => `${name} strongly enjoys ${rest}`],
    [/^prefers?\s+(.+)/i, (_, rest) => `${name} prefers ${rest}`],
    [/^strongly\s+drawn\s+to\s+(.+)/i, (_, rest) => `${name} is strongly drawn to ${rest}`],
    [/^drawn\s+to\s+(.+)/i, (_, rest) => `${name} is drawn to ${rest}`],
    [/^strongly\s+interested\s+in\s+(.+)/i, (_, rest) => `${name} is strongly interested in ${rest}`],
    [/^interested\s+in\s+(.+)/i, (_, rest) => `${name} is interested in ${rest}`],
    [/^strong\s+aversion\s+to\s+(.+)/i, (_, rest) => `${name} has a strong aversion to ${rest}`],
    [/^aversion\s+to\s+(.+)/i, (_, rest) => `${name} has an aversion to ${rest}`],
    [/^strongly\s+dislikes?\s+(.+)/i, (_, rest) => `${name} strongly dislikes ${rest}`],
    [/^dislikes?\s+(.+)/i, (_, rest) => `${name} dislikes ${rest}`],
    [/^avoids?\s+(.+)/i, (_, rest) => `${name} avoids ${rest}`]
  ];
  for (const [pattern, compose] of directPatterns) {
    const match = preference.match(pattern);
    if (match) return compose(...match);
  }
  return `${fallback.replace('{dimension}', dimensionLabel(signal))}: ${preference}`;
}

function signalLabel(signal) {
  return compactPreference(dimensionLabel(signal), 72);
}

function tasteSummary(signals, identity) {
  if (!signals.length) return { paragraphs: [`${identity.name}'s Taste Profile will take shape as reading feedback is recorded. There is not yet enough evidence to describe a reliable pattern.`], positives: [], friction: [], updated: null };
  const ranked = [...signals].sort((left, right) => signalRank(right) - signalRank(left));
  const positive = ranked.filter(signal => signal.direction === 'Positive').slice(0, 3);
  const negative = ranked.filter(signal => signal.direction === 'Negative').slice(0, 2);
  const mixed = ranked.filter(signal => signal.direction === 'Mixed').slice(0, 2);
  const cautious = ranked.filter(signal => signal.confidence === 'Low' || Number(signal.evidence_count) <= 1).slice(0, 2);
  const paragraphs = [];
  if (positive.length) paragraphs.push(`${positive.map(signal => thirdPersonPreference(signal, identity.name)).join('. ')}. These are the clearest patterns in the current reading record.`);
  if (negative.length) paragraphs.push(`${negative.map(signal => thirdPersonPreference(signal, identity.name)).join('. ')}. These friction signals are retained alongside positive preferences so recommendations do not overfit to only what works.`);
  if (mixed.length) paragraphs.push(`${mixed.map(signal => thirdPersonPreference(signal, identity.name, 'The evidence around {dimension} remains conditional')).join('. ')}. Context matters here, rather than a simple like-or-dislike rule.`);
  if (cautious.length) paragraphs.push(`Evidence is still limited around ${cautious.map(signal => dimensionLabel(signal)).join(' and ')}; those emerging signals should be treated as tentative.`);
  const latest = signals.map(signal => signal.last_updated).filter(Boolean).sort().at(-1) || null;
  return { paragraphs: paragraphs.slice(0, 4), positives: positive, friction: [...negative, ...mixed].slice(0, 5), updated: latest };
}

function tasteTab(state, identity) {
  const summary = tasteSummary(state.tasteProfile || [], identity);
  const signalList = (items, empty) => items.length ? `<ul>${items.map(item => `<li><span>${item.direction === 'Positive' ? '+' : '−'}</span>${escapeHtml(signalLabel(item))}</li>`).join('')}</ul>` : `<p class="profile-empty-copy">${empty}</p>`;
  return `<section class="profile-tab-content" id="profile-panel-taste" role="tabpanel" aria-labelledby="profile-tab-taste" tabindex="0"><div class="profile-section-heading"><p class="eyebrow">Live from your reading record</p><h2>${uiCopyHtml('profile.tasteProfile')}</h2>${summary.updated ? `<p>LAST UPDATED: ${escapeHtml(formatDate(summary.updated))}</p>` : ''}</div><div class="taste-prose">${summary.paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('')}</div><div class="taste-signals"><section><h3>${uiCopyHtml('profile.strongSignals')}</h3>${signalList(summary.positives, 'No high-confidence positive signals yet.')}</section><section><h3>${uiCopyHtml('profile.frictionSignals')}</h3>${signalList(summary.friction, 'No clear friction signals yet.')}</section></div></section>`;
}

function historyEvents(state) {
  const books = new Map(state.books.map(book => [book.id, book]));
  const sessions = (state.readingHistory || []).map(session => ({ ...session, book: books.get(session.book_id), eventType: 'session', completion: session.completed_at }));
  const sessionBookIds = new Set(sessions.map(session => session.book_id));
  const fallback = state.books.filter(book => book.overall_status === 'Read' && !sessionBookIds.has(book.id)).map(book => ({ id: `fallback-${book.id}`, book_id: book.id, book, completion: book.completed_at, user_rating_5: book.user_rating_5, format_read: book.format, eventType: 'fallback' }));
  return [...sessions, ...fallback].filter(event => event.book).sort((left, right) => {
    const rightDate = right.completion ? new Date(right.completion).getTime() : -Infinity;
    const leftDate = left.completion ? new Date(left.completion).getTime() : -Infinity;
    return rightDate - leftDate;
  });
}

function historyItem(event) {
  const book = event.book;
  const cover = book.cover_url ? `<img src="${escapeHtml(book.cover_url)}" alt="">` : `<span aria-hidden="true">BOOK</span>`;
  const rating = Number(event.user_rating_5);
  const metadata = [event.completion ? formatDate(event.completion) : 'Completion date not recorded', Number.isFinite(rating) ? `${rating.toFixed(1)} / 5` : '', event.format_read || ''].filter(Boolean);
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
  return `<section class="profile-tab-content" id="profile-panel-history" role="tabpanel" aria-labelledby="profile-tab-history" tabindex="0"><div class="profile-section-heading"><p class="eyebrow">${uiCopyHtml('profile.completedReads')}</p><h2>${uiCopyHtml('profile.history')}</h2><p>Newest completion first. Rereads are retained as separate entries.</p></div>${markup || '<p class="profile-empty">No completed reads have been recorded yet.</p>'}</section>`;
}

function statsTab(state) {
  return `<section class="profile-tab-content" id="profile-panel-stats" role="tabpanel" aria-labelledby="profile-tab-stats" tabindex="0"><div class="profile-section-heading"><p class="eyebrow">Canonical library data</p><h2>${uiCopyHtml('profile.readingRecord')}</h2><p>A concise record of the current collection and completed reading.</p></div><div class="profile-stat-record">${statRows(state)}</div></section>`;
}

export function profileView(state) {
  const identity = readerIdentity(state);
  const tab = ['stats', 'taste', 'history'].includes(state.profileTab) ? state.profileTab : 'stats';
  const tabs = [['stats', uiCopyHtml('profile.stats')], ['taste', uiCopyHtml('profile.tasteProfile')], ['history', uiCopyHtml('profile.history')]];
  const content = tab === 'taste' ? tasteTab(state, identity) : tab === 'history' ? historyTab(state) : statsTab(state);
  const avatarLabel = state.profile?.avatar_path ? 'Change profile photo' : 'Upload profile photo';
  return chrome(`<div class="profile-page"><header class="profile-page-title"><p class="eyebrow">Private reader profile</p><h1>${uiCopyHtml('profile.title')}</h1></header><section class="profile-card"><button class="profile-avatar" type="button" data-avatar-menu aria-label="${avatarLabel}">${profileImage(state.profile, identity)}<span class="profile-avatar-action-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 8.5h3l1.5-2h7l1.5 2h3v10H4z"/><circle cx="12" cy="13.5" r="3"/></svg></span></button><div class="profile-identity"><div class="profile-card-kicker"><span class="profile-private">PRIVATE</span><button class="profile-edit" type="button" data-profile-edit>Edit</button></div><h2>${escapeHtml(identity.displayName)}</h2><p class="profile-handle">${escapeHtml(identity.handle)}</p><p class="profile-role">Reader</p>${state.profile?.short_bio ? `<p class="profile-bio">${escapeHtml(state.profile.short_bio)}</p>` : '<p class="profile-bio">A private record of reading, preferences and finished books.</p>'}<label class="btn profile-upload terminal-profile-upload" for="profile-avatar-input"><span data-avatar-label>${state.profile?.avatar_path ? 'CHANGE PHOTO' : 'UPLOAD PHOTO'}</span></label><p class="profile-upload-help terminal-profile-upload">JPG, PNG or WebP · up to 5 MB</p></div></section><label class="sr-only" for="profile-avatar-input">${avatarLabel}</label><input class="sr-only" id="profile-avatar-input" type="file" data-avatar-input accept="image/jpeg,image/png,image/webp"><div class="profile-tabs" role="tablist" aria-label="Profile sections">${tabs.map(([key, label]) => `<button id="profile-tab-${key}" type="button" role="tab" data-profile-tab="${key}" aria-controls="profile-panel-${key}" aria-selected="${String(tab === key)}" tabindex="${tab === key ? '0' : '-1'}" class="${tab === key ? 'active' : ''}">${label}</button>`).join('')}</div>${content}</div>`, 'profile');
}
