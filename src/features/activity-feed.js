import { escapeHtml } from '../utils/text.js';

export const FEED_FILTERS = [['all','All'],['wishlist','Wishlist'],['started','Started'],['finished','Finished'],['bought','Bought'],['quotes','Quotes'],['librarian','Librarian']];
export function activityTime(value, now = new Date()) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return { label: 'Date unavailable', exact: 'Date unavailable', relative: false };
  const exact = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(date);
  const hours = Math.max(0, (now.getTime() - date.getTime()) / 3600000);
  const label = hours < 1 ? (hours < 1/60 ? 'now' : `${Math.floor(hours * 60)}m`) : hours < 24 ? `${Math.floor(hours)}h` : hours < 48 ? '1d' : exact;
  return { label, exact, relative: hours < 48 };
}

export function activityText(event, name, title) {
  const meta = event.metadata || {};
  if (event.content) return event.content;
  const rating = meta.rating != null ? ` and rated it ${Number(meta.rating)}/5` : '';
  return {
    wishlist: `${name} added ${title} to their wishlist.`,
    bought: `${name} ${meta.ownership_status === 'On Order' ? 'ordered' : 'marked as owned'} ${title}.`,
    started: `${name} started reading ${title}.`,
    finished: `${name} finished ${title}${rating}.`,
    rating: meta.rating == null ? `${name} removed the rating for ${title}.` : `${name} rated ${title} ${Number(meta.rating)}/5.`,
    paused: `${name} paused ${title}.`, dnf: `${name} marked ${title} as DNF.`,
    progress: `${name} reached ${meta.percent}% of ${title}.`,
    quotes: `${name} saved a passage from ${title}.`,
    taste: `Taste discovery · ${meta.dimension || 'Reading preferences'}\n${meta.preference || ''}\n${meta.direction || ''} · ${meta.confidence || ''} confidence`
  }[event.event_type] || 'Reading activity';
}

export function activityCard(event, state, now = new Date()) {
  const book = state.books.find(b => b.id === event.book_id);
  const librarian = ['librarian','taste'].includes(event.event_type);
  const handle = state.profile?.handle || '@reader';
  const name = state.profile?.display_name || handle;
  const title = book?.title || event.metadata?.book_title || 'a book';
  const time = activityTime(event.occurred_at, now);
  const meta = event.metadata || {};
  const text = activityText(event, name, title);
  const expandable = (value, quote = false) => {
    const id = `activity-${event.id}-${quote ? 'quote' : 'text'}`;
    return `<div id="${escapeHtml(id)}" class="feed-prose ${quote ? 'feed-quotation' : ''} ${value.length > 360 ? 'is-collapsed' : ''}">${escapeHtml(value)}</div>${value.length > 360 ? `<button type="button" class="inline-expand" data-expand="${escapeHtml(id)}" aria-controls="${escapeHtml(id)}" aria-expanded="false">See more</button>` : ''}`;
  };
  const pages = meta.page_start ? `p. ${meta.page_start}${meta.page_end && meta.page_end !== meta.page_start ? `–${meta.page_end}` : ''}` : meta.page ? `p. ${meta.page}` : '';
  const tags = [...new Set([...(event.hashtags || []), ['paused','dnf'].includes(event.event_type) ? 'progress' : event.event_type === 'taste' ? 'librarian' : event.event_type])];
  return `<article class="activity-card${librarian ? ' activity-librarian' : ''}" data-activity-id="${escapeHtml(event.id)}"><header class="activity-meta"><span class="feed-avatar" aria-hidden="true">${librarian ? '✦' : state.profile?.avatarUrl ? `<img src="${escapeHtml(state.profile.avatarUrl)}" alt="">` : escapeHtml(handle.replace(/^@/,'').slice(0,1).toUpperCase())}</span><strong>${escapeHtml(librarian ? 'Librarian' : handle)}</strong><button type="button" class="activity-time" data-exact-time="${escapeHtml(time.exact)}" aria-label="${escapeHtml(time.exact)}" title="${escapeHtml(time.exact)}"><time datetime="${escapeHtml(event.occurred_at)}">${escapeHtml(time.label)}</time></button></header><div class="activity-body">${expandable(text)}${event.event_type === 'quotes' ? `<blockquote>${expandable(meta.quote_text || '', true)}</blockquote>${meta.note ? `<p class="feed-personal-note">${escapeHtml(meta.note)}</p>` : ''}` : ''}${book ? `<a class="activity-book" href="#/book/${encodeURIComponent(book.id)}" data-open-book="${escapeHtml(book.id)}">${book.cover_url ? `<img src="${escapeHtml(book.cover_url)}" alt="" loading="lazy">` : '<span class="feed-cover-placeholder" aria-hidden="true">▤</span>'}<span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(book.authors || '')}</span><small>${escapeHtml([pages, meta.chapter ? `Chapter ${meta.chapter}` : '', meta.rating != null ? `${Number(meta.rating)}/5` : ''].filter(Boolean).join(' · '))}</small></span></a>` : ''}</div><footer class="activity-tags">${tags.map(tag => `<button type="button" data-feed-filter="${escapeHtml(tag)}" aria-label="Filter by ${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')}</footer></article>`;
}

export function feedTab(state) {
  const feed = state.activityFeed || { events: [], loading: true, filter: 'all' };
  const filters = FEED_FILTERS.some(([key]) => key === feed.filter) ? FEED_FILTERS : [...FEED_FILTERS, [feed.filter, `#${feed.filter}`]];
  return `<section class="profile-tab-content" id="profile-panel-feed" role="tabpanel" aria-labelledby="profile-tab-feed" tabindex="0"><nav class="feed-filters" aria-label="Activity filters">${filters.map(([key,label]) => `<button type="button" data-feed-filter="${escapeHtml(key)}" aria-pressed="${key === feed.filter}" class="${key === feed.filter ? 'active' : ''}">${escapeHtml(label)}</button>`).join('')}</nav><div class="activity-feed" aria-busy="${Boolean(feed.loading)}">${feed.events.map(event => activityCard(event,state)).join('')}</div><div class="feed-state" role="status" aria-live="polite">${feed.loading ? 'Loading your reading timeline…' : feed.error ? `<p>Could not load your timeline.</p><button class="btn" data-feed-retry>Try again</button>` : !feed.events.length ? '<p>No activity here yet. Your reading, quotes and discoveries will appear as they happen.</p>' : ''}</div>${feed.hasMore && !feed.loading && !feed.error ? '<button type="button" class="btn btn-full feed-load-more" data-feed-more>Load earlier entries</button>' : ''}</section>`;
}

// Shared event interactions are also used by browser fixtures.
export function handleFeedDisclosure(target) {
  const expand = target.closest('[data-expand]');
  if (expand) {
    const open = expand.getAttribute('aria-expanded') !== 'true';
    document.getElementById(expand.dataset.expand)?.classList.toggle('is-collapsed', !open);
    expand.setAttribute('aria-expanded', String(open)); expand.textContent = open ? 'See less' : 'See more';
    return true;
  }
  const time = target.closest('[data-exact-time]');
  if (time) { time.querySelector('time').textContent = time.dataset.exactTime; time.dataset.timeRevealed = 'true'; return true; }
  return false;
}
