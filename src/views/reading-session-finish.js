import { chrome } from '../ui/chrome.js';
import { escapeHtml } from '../utils/text.js';

export function readingSessionFinishView(session) {
  const duration = Math.max(0, (Date.parse(session.ended_at) - Date.parse(session.started_at)) / 1000);
  const pending = session.ended_at && session.progress_state === 'pending';
  const page = session.book.current_page ?? session.start_page;
  return chrome(`<section class="reading-session-finish"><p class="eyebrow">Reading session</p><h1>${escapeHtml(session.book.title)}</h1>${session.ended_at ? `<p class="muted">${Math.floor(duration / 60)} min ${Math.floor(duration % 60)} sec</p>` : ''}${pending ? `<form id="nfc-finish-form" class="form-stack" data-session-id="${escapeHtml(session.id)}"><div class="field"><label for="nfc-current-page">Current page</label><input id="nfc-current-page" class="input" name="page" type="number" inputmode="numeric" pattern="[0-9]*" min="0" step="1" ${session.book.total_pages ? `max="${session.book.total_pages}"` : ''} value="${escapeHtml(page)}" required autofocus></div><p role="alert" data-nfc-error></p><button class="btn btn-primary btn-full" type="submit">Save</button></form><button class="text-action" type="button" data-nfc-skip="${escapeHtml(session.id)}">Skip page entry</button>` : `<p>${session.ended_at ? 'This session is already saved or skipped.' : 'This session is still running. Tap the bookmark to end it.'}</p><button class="btn" data-open-book="${escapeHtml(session.book_id)}">Back to book</button>`}</section>`, 'home', { route: 'reading-session-finish', title: 'Reading session' });
}
