import { chrome } from '../ui/chrome.js';
import { cover as baseCover, esc, fmtDate, progressPct, progressText } from '../ui/format.js';
import { selectPrimaryRating } from '../utils/metadata.js';

const cover = book => baseCover(book, '', { eager: true, high: true });

const fmtRating = value => value == null ? '—' : Number(value).toFixed(2);
const fmtCount = value => value == null ? '' : new Intl.NumberFormat('en-GB', { notation: Number(value) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(Number(value));

function providerLogo(provider = '') {
  const name = provider.toLowerCase();
  if (name.includes('goodreads')) return './assets/goodreads.svg';
  if (name.includes('google')) return './assets/google-books.svg';
  if (name.includes('open library')) return './assets/open-library.svg';
  return null;
}

function ratingCard(rating) {
  const logo = providerLogo(rating.provider);
  const inner = `${logo ? `<img src="${logo}" alt="${esc(rating.provider)} logo">` : '<span class="rating-fallback">★</span>'}<span class="rating-copy"><strong>${fmtRating(rating.rating_5)}<small>/5</small></strong><span>${esc(rating.provider || 'Public')} · ${rating.rating_count != null ? `${esc(fmtCount(rating.rating_count))} ratings` : 'Public score'}</span></span>`;
  return rating.source_url ? `<a class="rating-card rating-public" href="${esc(rating.source_url)}" target="_blank" rel="noreferrer">${inner}</a>` : `<div class="rating-card rating-public">${inner}</div>`;
}

function userRatingCard(book) {
  const has = book.user_rating_5 != null;
  return `<button class="rating-card rating-user" type="button" data-review="${book.id}"><span class="rating-user-mark">YOU</span><span class="rating-copy"><strong>${has ? fmtRating(book.user_rating_5) : 'Rate'}${has ? '<small>/5</small>' : ''}</strong><span>${has ? 'Your rating · tap to edit' : 'Add your rating & review'}</span></span></button>`;
}

function shortSynopsis(text, max = 390) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return { short: clean, full: clean, truncated: false };
  let cut = clean.slice(0, max);
  cut = cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 45)).trim();
  return { short: `${cut}…`, full: clean, truncated: true };
}

function actions(book) {
  const reading = book.overall_status === 'Currently Reading';
  const canStart = ['Owned - Unread', 'Paused'].includes(book.overall_status) || (book.ownership_status === 'Owned' && !['Currently Reading', 'Read'].includes(book.overall_status));
  return `<div class="detail-actions">${reading ? `<button class="btn btn-primary" data-progress="${book.id}">Update progress</button>` : ''}${canStart ? `<button class="btn btn-primary" data-start="${book.id}">${book.overall_status === 'Paused' ? 'Resume reading' : 'Start reading'}</button>` : ''}${reading ? `<button class="btn" data-finish="${book.id}">Finish</button><button class="btn" data-pause="${book.id}">Pause</button><button class="btn btn-danger" data-dnf="${book.id}">DNF</button>` : ''}${book.overall_status !== 'Wishlist' && book.ownership_status !== 'Owned' ? `<button class="btn" data-wishlist="${book.id}">Add to wishlist</button>` : ''}<button class="btn" data-cover-picker="${book.id}">Edit cover</button></div>`;
}

function progress(book, chapter) {
  if (book.overall_status !== 'Currently Reading') return '';
  const pct = progressPct(book);
  return `<div class="progress-block"><div class="progress-meta"><span>${esc(progressText(book))}</span><span>${book.total_pages ? `${Math.round(pct)}%` : ''}</span></div>${chapter ? `<div class="chapter-progress-line">${esc(chapter)}</div>` : ''}<div class="progress-track"><div class="progress-fill" style="--progress:${pct}%"></div></div></div>`;
}

function pageLabel(quote) {
  if (quote.page_start && quote.page_end && quote.page_end !== quote.page_start) return `pp. ${quote.page_start}–${quote.page_end}`;
  return quote.page_start ? `p. ${quote.page_start}` : '';
}

function quotesSection(detail) {
  const quotes = detail.quotes || [];
  return `<section class="book-quotes-v40" data-detail-slot="quotes"><div class="book-quotes-head-v40"><div><h2>Quotes & passages${quotes.length ? ` <span>${quotes.length}</span>` : ''}</h2></div><div class="book-quotes-actions-v40"><button class="quote-scan-btn-v40" type="button" data-quote-scan>Scan page</button><button class="quote-manual-btn-v40" type="button" data-quote-add>+ Add</button></div></div>${quotes.length ? `<div class="saved-quotes-list-v40">${quotes.map(quote => { const location = [pageLabel(quote), quote.chapter].filter(Boolean).join(' · '); return `<article class="saved-quote-v40"><blockquote>${esc(quote.quote_text)}</blockquote>${location ? `<p class="saved-quote-location-v40">${esc(location)}</p>` : ''}${quote.note ? `<p class="saved-quote-note-v40">${esc(quote.note)}</p>` : ''}<div class="saved-quote-actions-v40"><button type="button" data-quote-edit="${quote.id}">Edit</button><button type="button" data-quote-delete="${quote.id}">Delete</button></div></article>`; }).join('')}</div>` : '<p class="book-quotes-empty-v40">No saved passages yet.</p>'}</section>`;
}

function exactCopy(book) {
  if (book.ownership_status !== 'Owned') return '';
  const pages = book.edition_page_count || book.total_pages;
  return `<section class="exact-copy-card" data-detail-slot="exact-copy"><div class="exact-copy-head"><div><span class="exact-copy-eyebrow">Your physical copy</span><strong>${book.exact_copy_verified ? 'Exact edition verified' : 'Edition not yet verified'}</strong></div><span class="copy-state ${book.exact_copy_verified ? 'ok' : 'warn'}">${book.exact_copy_verified ? 'Verified' : 'Check'}</span></div><div class="copy-facts"><div><span>ISBN</span><strong>${esc(book.isbn13 || book.isbn10 || 'Not recorded')}</strong></div><div><span>Pages</span><strong>${pages ? esc(pages) : 'Not recorded'}${book.page_count_verified ? ' · verified' : ' · not verified'}</strong></div><div><span>Cover</span><strong>${book.cover_verified ? (book.cover_uploaded_by_user ? 'Your photo · verified' : 'Verified') : 'Needs confirmation'}</strong></div></div><div class="copy-actions">${book.exact_copy_verified ? '' : `<button class="btn btn-primary" type="button" data-copy-verify>Verify this as my copy</button>`}${pages && !book.page_count_verified ? `<button class="btn" type="button" data-copy-confirm-pages>Confirm ${esc(pages)} pages</button>` : ''}<button class="btn" type="button" data-copy-photo>${book.cover_verified ? 'Replace cover photo' : 'Upload cover photo'}</button></div><p class="copy-help">For owned books, ISBN identifies the copy. Page count and cover are tracked separately so a bad catalogue record cannot silently corrupt reading progress.</p></section>`;
}

function metadataRows(book) {
  const rows = [['ISBN', book.isbn13 || book.isbn10], ['Publisher', [book.publisher, book.imprint].filter(Boolean).join(' · ')], ['Edition', [book.edition_year, book.edition_format].filter(Boolean).join(' · ')], ['Edition statement', book.edition_statement], ['Printing / impression', book.printing_impression], ['Printer code / number line', book.number_line], ['Original publication', book.original_publication_year], ['Language', book.language], ['Country', book.country], ['Series', book.series ? `${book.series}${book.series_order ? ` #${book.series_order}` : ''}` : null], ['Signed', book.signed === true ? 'Yes' : book.signed === false ? 'No' : null], ['Condition', book.condition], ['Dimensions', book.physical_dimensions], ['Metadata source', book.edition_metadata_source]].filter(([, value]) => value !== null && value !== undefined && String(value).trim());
  const pages = book.edition_page_count || book.total_pages;
  return `<div class="metadata-row"><span>Pages</span><strong class="metadata-edit-value">${pages ? esc(pages) : 'Not recorded'} <button class="text-action" type="button" data-page-count>Edit</button></strong></div>${rows.map(([key, value]) => `<div class="metadata-row"><span>${esc(key)}</span><strong>${esc(value)}</strong></div>`).join('')}`;
}

function metadata(detail) {
  const book = detail.book;
  return `<details class="metadata-accordion"><summary><span><strong>Book & edition details</strong><small>ISBN, publisher, printing, format and source data</small></span><span class="accordion-plus">+</span></summary><div class="metadata-list"><div class="book-admin-entry"><div><span class="book-admin-entry-label">Library record</span><strong>Edit status, reading dates and edition data</strong></div><button class="btn" type="button" data-book-admin>Edit book settings</button></div><div class="edition-browser-entry"><div><span>Edition catalogue</span><strong>Browse and switch between known editions</strong></div><button class="btn" type="button" data-editions>Browse editions</button></div>${exactCopy(book)}${metadataRows(book)}<div class="metadata-row"><span>Data</span><strong><button class="text-action" data-refresh-metadata>Refresh book data</button></strong></div></div></details>`;
}

export function bookDetailView(state) {
  const detail = state.detail;
  const book = detail.book;
  const primary = selectPrimaryRating(detail.ratings);
  const otherRatings = detail.ratings.filter(rating => rating !== primary);
  const recommendation = detail.recommendation;
  const tags = [book.overall_status, book.ownership_status, book.primary_genre, book.edition_format].filter(Boolean);
  const synopsis = shortSynopsis(book.synopsis || 'Synopsis not available yet.');
  const chapterRow = state.chapters.find(row => row.id === book.id);
  const chapter = chapterRow?.current_chapter_title || (chapterRow?.current_chapter_number ? `Chapter ${chapterRow.current_chapter_number}` : '');
  const review = book.review_notes || book.user_review || '';
  const content = `<button class="back-btn" data-back>← Back</button><section class="detail-header" data-book-id="${book.id}" data-library-detail="ready">${cover(book)}<div class="detail-copy detail-copy-v4"><p class="eyebrow">${esc(book.fiction_nonfiction || 'Book')}</p><h1>${esc(book.title)}</h1><div class="hero-author">${esc(book.authors || 'Unknown author')}</div><div class="meta">${tags.map(tag => `<span class="badge">${esc(tag)}</span>`).join('')}${recommendation?.match_score_10 != null ? `<span class="badge accent">Predicted fit ${Number(recommendation.match_score_10).toFixed(1)}/10</span>` : ''}</div><div class="rating-strip rating-primary-row">${primary ? ratingCard(primary) : '<div class="rating-card rating-public rating-empty-card"><span class="rating-fallback">★</span><span class="rating-copy"><strong>—</strong><span>Public rating unavailable</span></span></div>'}${userRatingCard(book)}</div>${otherRatings.length ? `<div class="other-ratings">${otherRatings.map(ratingCard).join('')}</div>` : ''}<section class="book-synopsis"><h2>Synopsis</h2><p><span class="synopsis-text">${esc(synopsis.short)}</span>${synopsis.truncated ? ` <button class="read-more" type="button" data-synopsis data-short="${esc(synopsis.short)}" data-full="${esc(synopsis.full)}">Read more</button>` : ''}</p></section>${quotesSection(detail)}${progress(book, chapter)}${actions(book)}${review ? `<section class="review-panel"><p class="eyebrow">Your review</p><p>${esc(review)}</p><button class="text-action" type="button" data-review="${book.id}">Edit rating & review</button></section>` : ''}<div class="reading-dates"><div><small>Started</small><strong>${fmtDate(book.started_at)}</strong></div><div><small>Finished</small><strong>${fmtDate(book.completed_at)}</strong></div><div><small>Length</small><strong>${book.total_pages ? `${esc(book.total_pages)} pages` : 'Not recorded'}</strong></div></div>${recommendation?.why_recommended ? `<section class="recommendation-panel"><p class="eyebrow">Librarian note</p><h2>Why it was recommended</h2><p>${esc(recommendation.why_recommended)}</p>${recommendation.outcome ? `<span class="badge">Prediction: ${esc(recommendation.outcome)}</span>` : ''}</section>` : ''}${metadata(detail)}</div></section>`;
  return chrome(content, state.route.returnTo || 'library');
}
