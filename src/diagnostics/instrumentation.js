function dimensions() {
  return { scroll_y: window.scrollY, document_height: document.documentElement.scrollHeight, viewport_height: window.innerHeight };
}

export function recordCurrentTitleState(diagnostics, reason = 'paint_complete') {
  if (!diagnostics.isActive()) return;
  const title = document.querySelector('[data-current-card] h1');
  if (!title) return;
  const card = title.closest('[data-current-card]');
  const computed = getComputedStyle(title);
  diagnostics.event('current_title_state', {
    reason, book_id: card?.dataset.currentCard || null,
    semantic_variant: title.dataset.titleVariant || 'normal', class_name: title.className || '',
    inline_font_size: title.style.fontSize || null, inline_line_height: title.style.lineHeight || null,
    computed_font_size: computed.fontSize, computed_line_height: computed.lineHeight,
    client_width: title.clientWidth, client_height: title.clientHeight
  });
}

export function installDiagnosticsInstrumentation({ diagnostics, getRoute }) {
  if (!diagnostics.isEnabled()) return () => {};
  let scrollFrame = null;
  let lastCheckpoint = { y: window.scrollY, at: performance.now() };
  let lastObserved = { y: window.scrollY, at: performance.now() };
  let lastViewport = `${window.innerWidth}x${window.innerHeight}`;

  const route = () => getRoute?.() || {};
  const checkpoint = (reason, force = false) => {
    scrollFrame = null;
    const time = performance.now();
    const y = window.scrollY;
    if (!force && Math.abs(y - lastCheckpoint.y) < 100 && time - lastCheckpoint.at < 1000) return;
    diagnostics.event('scroll_checkpoint', { reason, ...dimensions(), previous_checkpoint_y: lastCheckpoint.y });
    lastCheckpoint = { y, at: time };
  };
  const onScroll = () => {
    const time = performance.now();
    const y = window.scrollY;
    if (Math.abs(y - lastObserved.y) >= Math.max(300, window.innerHeight * .55) && time - lastObserved.at < 850) {
      diagnostics.event('large_scroll_jump_detected', { from_y: lastObserved.y, to_y: y, elapsed_ms: Math.round(time - lastObserved.at) });
    }
    lastObserved = { y, at: time };
    if (scrollFrame === null) scrollFrame = requestAnimationFrame(() => checkpoint('scroll'));
  };
  const visibility = () => {
    const hidden = document.visibilityState === 'hidden';
    checkpoint(hidden ? 'visibility_hidden' : 'visibility_visible', true);
    diagnostics.event(hidden ? 'visibility_hidden' : 'visibility_visible', { ...dimensions(), route: route().name });
    if (!hidden) recordCurrentTitleState(diagnostics, 'visibility_visible');
  };
  const pageHide = event => {
    checkpoint('pagehide', true);
    diagnostics.event('pagehide', { persisted: Boolean(event.persisted), ...dimensions() }, { immediate: true });
  };
  const pageShow = event => {
    diagnostics.event('pageshow', { persisted: Boolean(event.persisted), ...dimensions() });
    recordCurrentTitleState(diagnostics, 'pageshow');
  };
  const resize = () => {
    const next = `${window.innerWidth}x${window.innerHeight}`;
    if (next === lastViewport) return;
    diagnostics.event('viewport_changed', { previous: lastViewport, current: next, orientation: screen.orientation?.type || null });
    lastViewport = next;
  };
  const safeError = (type, error) => diagnostics.event(type, {
    name: error?.name || 'Error', message: error?.message || String(error || 'Unknown error'), stack: error?.stack || null
  }, { immediate: true });
  const onError = event => safeError('window_error', event.error || event.message);
  const onRejection = event => safeError('unhandled_rejection', event.reason);
  const freeze = () => diagnostics.event('freeze', { ...dimensions() }, { immediate: true });
  const resume = () => diagnostics.event('resume', { ...dimensions() });

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('pagehide', pageHide);
  window.addEventListener('pageshow', pageShow);
  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('orientationchange', resize, { passive: true });
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('freeze', freeze);
  document.addEventListener('resume', resume);
  return () => {
    if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('pagehide', pageHide);
    window.removeEventListener('pageshow', pageShow);
    window.removeEventListener('resize', resize);
    window.removeEventListener('orientationchange', resize);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('freeze', freeze);
    document.removeEventListener('resume', resume);
  };
}

export function diagnosticScrollTo(diagnostics, reason, options, metadata = {}) {
  if (diagnostics.isActive()) diagnostics.event('programmatic_scroll_requested', {
    reason, current_y: window.scrollY, target_y: typeof options === 'object' ? options.top : options, ...metadata
  }, { immediate: true });
  window.scrollTo(options);
}

export async function connectServiceWorkerDiagnostics(diagnostics, registration = null) {
  if (!diagnostics.isActive() || !('serviceWorker' in navigator)) return;
  const controller = navigator.serviceWorker.controller;
  diagnostics.event('sw_registration_state', {
    installing: registration?.installing?.state || null, waiting: registration?.waiting?.state || null,
    active: registration?.active?.state || null
  });
  diagnostics.event('sw_controller_state', { controlled: Boolean(controller), script: controller?.scriptURL ? new URL(controller.scriptURL).pathname : null });
  controller?.postMessage({ type: 'SET_DIAGNOSTICS', enabled: true });
  return requestServiceWorkerDiagnosticSnapshot(diagnostics);
}

export async function requestServiceWorkerDiagnosticSnapshot(diagnostics) {
  if (!diagnostics.isActive() || !('serviceWorker' in navigator)) return;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  const channel = new MessageChannel();
  const result = new Promise(resolve => {
    const timeout = setTimeout(() => resolve(null), 800);
    channel.port1.onmessage = event => { clearTimeout(timeout); resolve(event.data); };
  });
  controller.postMessage({ type: 'GET_DIAGNOSTIC_STATE' }, [channel.port2]);
  const state = await result;
  if (!state) { diagnostics.event('sw_diagnostic_unavailable', { reason: 'message_timeout' }); return null; }
  diagnostics.event('sw_diagnostic_snapshot', state);
  return state;
}
