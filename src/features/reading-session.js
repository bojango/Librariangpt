// Shared display calculations never mutate canonical progress.
export function durationSeconds(session, now = Date.now()) {
  const seconds = ((session.ended_at ? Date.parse(session.ended_at) : now) - Date.parse(session.started_at)) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
}
export function durationHms(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return [Math.floor(value / 3600), Math.floor(value / 60) % 60, value % 60].map(n => String(n).padStart(2, '0')).join(':');
}
export function localSessionTime(value) {
  return value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}
export function sessionStats(session, input) {
  const page = input === '' ? NaN : Number(input);
  const minimum = Math.max(session.start_page, session.book.current_page ?? 0);
  const valid = Number.isInteger(page) && page >= minimum && (!session.book.total_pages || page <= session.book.total_pages);
  const pages = valid ? page - session.start_page : null;
  const seconds = durationSeconds(session);
  return { valid, pages, pace: valid && seconds >= 60 ? (pages * 3600 / seconds).toFixed(1) : null, minimum };
}

// Coalesce visibility + focus and check identity/route again after async reads.
export function createNfcLifecycleCheck({ load, allowed, identity, navigate, onError, now = Date.now }) {
  let inFlight = null;
  let lastCheck = -Infinity;
  return async ({ force = false } = {}) => {
    if (!allowed()) return;
    if (inFlight) return inFlight;
    if (!force && now() - lastCheck < 750) return;
    const user = identity();
    inFlight = (async () => {
      try {
        const route = await load();
        if (route && allowed() && identity() === user) navigate(route);
      } catch (error) { onError?.(error); }
      finally { lastCheck = now(); inFlight = null; }
    })();
    return inFlight;
  };
}

export function attachSessionDisplay(root, session) {
  let timer = null;
  const tick = () => {
    const display = root.querySelector('[data-session-timer]');
    if (display) display.textContent = durationHms(durationSeconds(session));
  };
  const visibility = () => {
    clearInterval(timer); timer = null;
    if (!session.ended_at && document.visibilityState !== 'hidden') { tick(); timer = setInterval(tick, 1000); }
  };
  const input = root.querySelector('#nfc-current-page');
  const update = () => {
    const stats = sessionStats(session, input.value);
    root.querySelector('[data-session-pages]').textContent = stats.pages ?? '—';
    root.querySelector('[data-session-pace]').textContent = stats.pace == null ? '—' : `${stats.pace} pages/hour`;
    input.setCustomValidity(stats.valid ? '' : `Enter a whole page from ${stats.minimum}${session.book.total_pages ? ` to ${session.book.total_pages}` : ' onwards'}.`);
  };
  if (input) { input.addEventListener('input', update); update(); }
  document.addEventListener('visibilitychange', visibility); visibility();
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visibility); input?.removeEventListener('input', update); };
}
