import { chrome } from '../ui/chrome.js';

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

function tasteSummary(signals, identity) {
  if (!signals.length) return { paragraphs: [`${identity.name}'s Taste Profile will take shape as reading feedback is recorded. There is not yet enough evidence to describe a reliable pattern.`], positives: [], friction: [], updated: null };
  const ranked = [...signals].sort((left, right) => signalRank(right) - signalRank(left));
  const positive = ranked.filter(signal => signal.direction === 'Positive').slice(0, 4);
  const negative = ranked.filter(signal => signal.direction === 'Negative').slice(0, 3);
  const mixed = ranked.filter(signal => signal.direction === 'Mixed').slice(0, 2);
  const cautious = ranked.filter(signal => signal.confidence === 'Low' || Number(signal.evidence_count) <= 1).slice(0, 2);
  const paragraphs = [];
  if (positive.length) paragraphs.push(`${identity.name} is most consistently drawn to ${positive.map(signal => escapeHtml(preferencePhrase(signal.preference))).join(', ')}. These are the clearest patterns in the current reading record.`);
  if (negative.length) paragraphs.push(`${identity.name} tends to find ${negative.map(signal => escapeHtml(preferencePhrase(signal.preference))).join(', ')} less rewarding. These friction signals are retained alongside positive preferences so recommendations do not overfit to only what works.`);
  if (mixed.length) paragraphs.push(`Some responses remain conditional: ${mixed.map(signal => escapeHtml(preferencePhrase(signal.preference))).join('; ')}. Context matters here, rather than a simple like-or-dislike rule.`);
  if (cautious.length) paragraphs.push(`Evidence is still limited around ${cautious.map(signal => escapeHtml(signal.dimension || signal.preference)).join(' and ')}; those emerging signals should be treated as tentative.`);
  const latest = signals.map(signal => signal.last_updated).filter(Boolean).sort().at(-1) || null;
  return { paragraphs: paragraphs.slice(0, 4), positives: positive, friction: [...negative, ...mixed].slice(0, 5), updated: latest };
}

function tasteTab(state, identity) {
  const summary = tasteSummary(state.tasteProfile || [], identity);
  const signalList = (items, empty) => items.length ? `<ul>${items.map(item => `<li><span>${item.direction === 'Positive' ? '+' : '−'}</span>${escapeHtml(preferencePhrase(item.preference))}</li>`).join('')}</ul>` : `<p class="profile-empty-copy">${empty}</p>`;
  return `<section class="profile-tab-content" id="profile-panel-taste" role="tabpanel" aria-labelledby="profile-tab-taste" tabindex="0"><div class="profile-section-heading"><p class="eyebrow">Live from your reading record</p><h2>Taste Profile</h2>${summary.updated ? `<p>LAST UPDATED: ${escapeHtml(formatDate(summary.updated))}</p>` : ''}</div><div class="taste-prose">${summary.paragraphs.map(paragraph => `<p>${paragraph}</p>`).join('')}</div><div class="taste-signals"><section><h3>Strong signals</h3>${signalList(summary.positives, 'No high-confidence positive signals yet.')}</section><section><h3>Friction signals</h3>${signalList(summary.friction, 'No clear friction signals yet.')}</section></div></section>`;
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
  return `<section class="profile-tab-content" id="profile-panel-history" role="tabpanel" aria-labelledby="profile-tab-history" tabindex="0"><div class="profile-section-heading"><p class="eyebrow">Completed reads</p><h2>Reading History</h2><p>Newest completion first. Rereads are retained as separate entries.</p></div>${markup || '<p class="profile-empty">No completed reads have been recorded yet.</p>'}</section>`;
}

function statsTab(state) {
  return `<section class="profile-tab-content" id="profile-panel-stats" role="tabpanel" aria-labelledby="profile-tab-stats" tabindex="0"><div class="profile-section-heading"><p class="eyebrow">Canonical library data</p><h2>Reading Record</h2><p>A concise record of the current collection and completed reading.</p></div><div class="profile-stat-record">${statRows(state)}</div></section>`;
}

export function profileView(state) {
  const identity = readerIdentity(state);
  const tab = ['stats', 'taste', 'history'].includes(state.profileTab) ? state.profileTab : 'stats';
  const tabs = [['stats', 'Stats'], ['taste', 'Taste Profile'], ['history', 'History']];
  const content = tab === 'taste' ? tasteTab(state, identity) : tab === 'history' ? historyTab(state) : statsTab(state);
  return chrome(`<div class="profile-page"><header class="profile-page-title"><p class="eyebrow">Private reader profile</p><h1>Profile</h1></header><section class="profile-card"><div class="profile-avatar">${profileImage(state.profile, identity)}</div><div class="profile-identity"><span class="profile-private">PRIVATE</span><h2>${escapeHtml(identity.displayName)}</h2><p class="profile-handle">${escapeHtml(identity.handle)}</p><p class="profile-role">Reader</p>${state.profile?.short_bio ? `<p class="profile-bio">${escapeHtml(state.profile.short_bio)}</p>` : '<p class="profile-bio">A private record of reading, preferences and finished books.</p>'}<label class="btn profile-upload"><span data-avatar-label>${state.profile?.avatar_path ? 'CHANGE PHOTO' : 'UPLOAD PHOTO'}</span><input type="file" data-avatar-input accept="image/jpeg,image/png,image/webp" aria-label="${state.profile?.avatar_path ? 'Change profile photo' : 'Upload profile photo'}"></label><p class="profile-upload-help">JPG, PNG or WebP · up to 5 MB</p></div></section><div class="profile-tabs" role="tablist" aria-label="Profile sections">${tabs.map(([key, label]) => `<button id="profile-tab-${key}" type="button" role="tab" data-profile-tab="${key}" aria-controls="profile-panel-${key}" aria-selected="${String(tab === key)}" tabindex="${tab === key ? '0' : '-1'}" class="${tab === key ? 'active' : ''}">${label}</button>`).join('')}</div>${content}</div>`, 'profile');
}
