import { escapeHtml as esc } from '../utils/text.js';
import { coverMarkup } from '../ui/cover.js';
import { fmtDate } from '../ui/format.js';
import { localSessionTime } from '../features/reading-session.js';

export function sessionHeading(session, change) {
  return `<div class="session-book-heading">${coverMarkup(session.book, '', { eager: true })}<div class="session-book-copy"><h1>${esc(session.book.title)}</h1><p class="muted session-author">${esc(session.book.authors || 'Unknown author')}</p></div>${change ? `<button class="text-action" type="button" data-session-change="${esc(session.id)}">Change</button>` : ''}</div>`;
}

export function sessionFact(label, value, attributes = '') {
  return `<div><dt>${label}</dt><dd ${attributes}>${value}</dd></div>`;
}

export function sessionDate(value) {
  return value ? `<time class="session-stamp" datetime="${esc(value)}"><span>${esc(fmtDate(value))}</span><span>${esc(localSessionTime(value))}</span></time>` : '—';
}

export function sessionRecord(session) {
  return `<dl class="session-facts session-record">${sessionFact('Started', sessionDate(session.started_at))}${session.ended_at ? sessionFact('Finished', sessionDate(session.ended_at)) : ''}${sessionFact('Starting page', esc(session.start_page))}${!session.ended_at ? sessionFact('Session type', session.session_kind === 'test' ? 'Test' : 'Reading') : ''}</dl>`;
}
