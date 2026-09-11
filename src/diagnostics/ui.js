import { escapeHtml } from '../utils/text.js';
import { closeModal, showModal, toast } from '../ui/feedback.js';
import { requestServiceWorkerDiagnosticSnapshot } from './instrumentation.js';

const CATEGORIES = [
  ['title_wrong', 'Title wrong'], ['scroll_jump', 'Scroll jumped'], ['covers_flashed', 'Covers flashed'],
  ['whole_page_flickered', 'Whole page flickered'], ['missing_content', 'Missing content'],
  ['navigation_issue', 'Navigation issue'], ['other', 'Other']
];

export function diagnosticsMenuMarkup(diagnostics) {
  const state = diagnostics.snapshot();
  if (!state.enabled) return `<section class="sidebar-section diagnostics-menu"><h3>Test Mode</h3><p class="diagnostics-copy">Record a private local trace for troubleshooting.</p><button class="btn" data-diag-enable>Turn on</button></section>`;
  if (!state.active) return `<section class="sidebar-section diagnostics-menu"><h3>Test Mode · On</h3><p class="diagnostics-copy">No session is currently recording.</p><div class="sidebar-actions"><button class="btn btn-primary" data-diag-start>Start fresh session</button><button class="btn" data-diag-disable>Turn off</button></div><div data-diag-history></div></section>`;
  const elapsed = Math.max(0, Math.round((Date.now() - new Date(state.started_at).getTime()) / 60000));
  return `<section class="sidebar-section diagnostics-menu"><h3>Test Mode · On</h3><dl class="diagnostics-summary"><div><dt>Code</dt><dd>${escapeHtml(state.session_code)}</dd></div><div><dt>Elapsed</dt><dd>${elapsed} min</dd></div><div><dt>Events</dt><dd>${state.event_count}</dd></div></dl><div class="sidebar-actions"><button class="btn" data-diag-mark>Mark issue</button><button class="btn btn-primary" data-diag-upload>End &amp; upload</button><button class="btn" data-diag-end>End without upload</button><button class="btn" data-diag-copy>Copy code</button><button class="btn" data-diag-disable>Turn off</button></div><div data-diag-history></div></section>`;
}

export function diagnosticHistoryMarkup(sessions, activeId = null) {
  const recent = sessions.filter(session => session.id !== activeId && session.ended_at).slice(0, 5);
  if (!recent.length) return '';
  return `<div class="diagnostic-history"><h4>Recent sessions</h4>${recent.map(session => `<div class="diagnostic-history-row"><div><strong>${escapeHtml(session.session_code)}</strong><small>${escapeHtml(new Date(session.started_at).toLocaleDateString())} · ${session.event_count} events · ${escapeHtml(session.upload_status || 'local')}</small></div><button class="btn" data-diag-copy-session="${escapeHtml(session.session_code)}">Copy</button>${session.upload_status !== 'uploaded' ? `<button class="btn" data-diag-retry="${escapeHtml(session.id)}">Upload</button>` : ''}</div>`).join('')}</div>`;
}

export function syncTestIndicator(diagnostics) {
  document.querySelectorAll('[data-test-indicator]').forEach(node => node.remove());
  if (!diagnostics.isActive()) return;
  const actions = document.querySelector('.topbar .top-actions');
  if (!actions) return;
  const indicator = document.createElement('span');
  indicator.dataset.testIndicator = '';
  indicator.className = 'test-mode-indicator';
  indicator.textContent = 'TEST';
  actions.prepend(indicator);
}

export function openIssueMarker(diagnostics) {
  showModal(`<h2>Mark issue</h2><p>Choose what you just saw. The marker is saved immediately.</p><div class="diagnostic-categories">${CATEGORIES.map(([value, label]) => `<button class="btn" data-diag-category="${value}">${label}</button>`).join('')}</div><div class="modal-actions"><button class="btn" data-close>Cancel</button></div>`, 'diagnostic-marker-backdrop');
  document.querySelectorAll('[data-diag-category]').forEach(button => button.addEventListener('click', async () => {
    await diagnostics.markIssue(button.dataset.diagCategory);
    requestServiceWorkerDiagnosticSnapshot(diagnostics).catch(() => {});
    closeModal();
    toast('Issue marked.');
  }));
}
