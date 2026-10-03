import { chrome } from '../ui/chrome.js';
import { escapeHtml as esc } from '../utils/text.js';
import { sessionHeading } from './reading-session-finish.js';
import { durationHms, durationSeconds, localSessionTime } from '../features/reading-session.js';

export function readingSessionActiveView(session) {
  return chrome(`<section class="reading-session-finish">${sessionHeading(session, true)}<p class="session-duration" data-session-timer role="timer" aria-label="Elapsed reading time">${durationHms(durationSeconds(session))}</p><p class="muted session-duration-label">Session in progress</p><dl class="session-facts"><div><dt>Started at</dt><dd>${localSessionTime(session.started_at)}</dd></div><div><dt>Starting page</dt><dd>${session.start_page}</dd></div></dl><button class="btn btn-primary btn-full" type="button" data-session-end="${esc(session.id)}">End session</button><div class="session-actions"><button class="text-action" type="button" data-session-change="${esc(session.id)}">Change book</button><button class="text-action" type="button" data-session-restart="${esc(session.id)}">Restart session</button></div></section>`, 'home', { route: 'reading-session-active', title: 'Reading session' });
}
