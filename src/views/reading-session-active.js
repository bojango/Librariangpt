import { chrome } from '../ui/chrome.js';
import { escapeHtml as esc } from '../utils/text.js';
import { sessionHeading, sessionRecord } from './reading-session-shared.js';
import { durationHms, durationSeconds } from '../features/reading-session.js';

export function readingSessionActiveView(session) {
  return chrome(`<section class="reading-session-finish session-card">${sessionHeading(session, true)}<p class="session-duration" data-session-timer role="timer" aria-label="Elapsed reading time">${durationHms(durationSeconds(session))}</p><p class="eyebrow session-duration-label">Session in progress</p>${sessionRecord(session)}<div class="session-submit-area"><button class="btn btn-primary btn-full" type="button" data-session-end="${esc(session.id)}">End session</button><div class="session-actions"><button class="text-action" type="button" data-session-restart="${esc(session.id)}">Restart session</button></div></div></section>`, 'home', { route: 'reading-session-active', title: 'Reading session' });
}
