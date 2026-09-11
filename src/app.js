import { supabase } from './data/supabase.js';
import { clearRequestDedupe, invoke, loadBookDetail, refreshLibrary, rpc, setDataDiagnosticHook } from './data/library.js';
import { createAppState } from './state.js';
import { createRouter } from './router.js';
import { detailFingerprint, sameRoute, snapshotFingerprint } from './lifecycle.js';
import { authView, claimView, errorView } from './views/auth.js';
import { homeView } from './views/home.js';
import { libraryView } from './views/library.js';
import { statsView } from './views/stats.js';
import { bookDetailView } from './views/book-detail.js';
import { loadingBookView } from './views/loading.js';
import { closeModal, toast } from './ui/feedback.js';
import { openAddBook } from './features/add-book.js';
import { addToWishlist, confirmPause, openCoverPicker, openDnf, openFinish, openPageCount, openProgress, openReview, openStart, refreshMetadata } from './features/reading-actions.js';
import { initialiseCarousel, openRecommendation, openRecommendationsPage, openUpNextDetails, openUpNextManager } from './features/home-actions.js';
import { openBookAdmin } from './features/book-admin.js';
import { openEditionBrowser } from './features/editions.js';
import { handleExactCopyAction } from './features/exact-copy.js';
import { handleQuoteAction } from './features/quotes.js';
import { activateCovers, collectCoverImages, reuseCoverImages, setCoverDiagnosticHook } from './ui/cover.js';
import { animateProgress, installMotionController, progressSnapshot } from './ui/motion.js';
import { installScrollLifecycle } from './scroll-lifecycle.js';
import { createSupabaseDiagnosticUploader, diagnostics } from './diagnostics/diagnostics.js';
import { connectServiceWorkerDiagnostics, diagnosticScrollTo, installDiagnosticsInstrumentation, recordCurrentTitleState, requestServiceWorkerDiagnosticSnapshot } from './diagnostics/instrumentation.js';
import { diagnosticHistoryMarkup, diagnosticsMenuMarkup, openIssueMarker, syncTestIndicator } from './diagnostics/ui.js';

const app = document.querySelector('#app');
const store = createAppState();
let router;
let previousRoute = 'home';
let bookHasReturnRoute = false;
let dataLoad = null;
let libraryLoaded = false;
let scrollRestoreFrame = null;
let sessionBootstrapUser = null;
let scrollTrackingSuspended = false;
let diagnosticDisposer = null;
let serviceWorkerRegistration = null;
let motionController = null;
let skipNextRouteTransition = false;

diagnostics.configure({
  context: () => ({ route: store.value.route, bookId: store.value.route.bookId || null }),
  uploader: createSupabaseDiagnosticUploader(supabase)
});

function startDiagnosticRuntime() {
  if (!diagnostics.isEnabled() || diagnosticDisposer) return;
  const disposeLifecycle = installDiagnosticsInstrumentation({ diagnostics, getRoute: () => store.value.route });
  const controllerChange = () => {
    diagnostics.event('sw_controllerchange', { controlled: Boolean(navigator.serviceWorker?.controller) });
    connectServiceWorkerDiagnostics(diagnostics, serviceWorkerRegistration).catch(() => {});
  };
  navigator.serviceWorker?.addEventListener('controllerchange', controllerChange);
  setCoverDiagnosticHook(diagnostics);
  setDataDiagnosticHook(diagnostics);
  diagnosticDisposer = () => {
    disposeLifecycle();
    navigator.serviceWorker?.removeEventListener('controllerchange', controllerChange);
    navigator.serviceWorker?.controller?.postMessage({ type: 'SET_DIAGNOSTICS', enabled: false });
    setCoverDiagnosticHook(null);
    setDataDiagnosticHook(null);
    diagnosticDisposer = null;
  };
  diagnostics.event('app_generation', { generation: document.querySelector('meta[name="reading-room-generation"]')?.content || 'unknown' });
  diagnostics.event('document_ready_state', { ready_state: document.readyState });
  diagnostics.event('display_mode', diagnostics.environment());
  connectServiceWorkerDiagnostics(diagnostics, serviceWorkerRegistration).catch(() => {});
}

function stopDiagnosticRuntime() {
  diagnosticDisposer?.();
}

function cancelScrollRestore() {
  if (scrollRestoreFrame !== null) cancelAnimationFrame(scrollRestoreFrame);
  scrollRestoreFrame = null;
  app.classList.remove('route-scroll-lock');
}

function currentBook(id = store.value.route.bookId) {
  return store.value.detail?.book?.id === id ? store.value.detail.book : store.value.books.find(book => book.id === id);
}

function saveCurrentScroll() {
  const name = store.value.route.name;
  if (['home', 'library', 'wishlist'].includes(name)) store.saveScroll(name, window.scrollY);
}

function syncNavigation(current, next) {
  const active = next.querySelector('.nav-btn.active')?.dataset.route;
  current.querySelectorAll('.nav-btn').forEach(button => {
    const isActive = button.dataset.route === active;
    button.classList.toggle('active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function markRouteEntry(main) {
  if (!main || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  main.classList.add('route-enter');
  main.addEventListener('animationend', () => main.classList.remove('route-enter'), { once: true });
}

function positionAfterPaint(top, reason, route, renderMode, { save = false } = {}) {
  scrollTrackingSuspended = true;
  motionController?.suspend();
  diagnosticScrollTo(diagnostics, reason, { top, left: 0, behavior: 'instant' }, { route: route.name, render_mode: renderMode });
  scrollRestoreFrame = requestAnimationFrame(() => {
    scrollRestoreFrame = null;
    app.classList.remove('route-scroll-lock');
    if (sameRoute(store.value.route, route) && save) store.saveScroll(route.name, window.scrollY);
    scrollTrackingSuspended = false;
    motionController?.resume();
  });
}

function paint(html, { restore = false, restoreY: requestedRestoreY = null, preserveScroll = null, positionY = null, positionReason = 'route_position', lockScrollAnchor = false, reuseCovers = false, transition = false, renderMode = 'direct' } = {}) {
  const tracing = diagnostics.isActive();
  cancelScrollRestore();
  if (restore || Number.isFinite(positionY) || Number.isFinite(preserveScroll)) {
    scrollTrackingSuspended = true;
    motionController?.suspend();
  }
  const restoreRoute = restore ? { ...store.value.route } : null;
  const restoreY = restore ? (Number.isFinite(requestedRestoreY) ? requestedRestoreY : store.scrollFor(restoreRoute.name)) : null;
  const oldCoverCount = tracing ? app.querySelectorAll('.cover-image').length : 0;
  const previousProgress = progressSnapshot(app);
  const coverPool = reuseCovers ? collectCoverImages(app) : null;
  if (tracing) diagnostics.event('paint_start', { route: store.value.route.name, render_mode: renderMode, restore_requested: Boolean(restore), preserve_scroll: Number.isFinite(preserveScroll), old_cover_count: oldCoverCount });
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  const nextRoot = template.content.firstElementChild;
  const currentLayout = app.firstElementChild?.matches('.layout') ? app.firstElementChild : null;
  const nextLayout = nextRoot?.matches('.layout') ? nextRoot : null;
  if (lockScrollAnchor) app.classList.add('route-scroll-lock');
  let activationRoot = app;
  let replacement = 'app_root';
  let reusedCoverCount = 0;
  if (currentLayout && nextLayout) {
    const currentMain = currentLayout.querySelector(':scope > main');
    const nextMain = nextLayout.querySelector(':scope > main');
    if (coverPool) reusedCoverCount = reuseCoverImages(nextMain, coverPool, { activate: false });
    if (transition) markRouteEntry(nextMain);
    currentMain.replaceWith(nextMain);
    syncNavigation(currentLayout.querySelector(':scope > .bottom-nav'), nextLayout.querySelector(':scope > .bottom-nav'));
    activationRoot = nextMain;
    replacement = 'main_only';
  } else {
    if (transition) markRouteEntry(nextLayout?.querySelector(':scope > main'));
    app.replaceChildren(template.content);
  }
  app.dataset.routeView = store.value.route.name;
  activateCovers(activationRoot);
  animateProgress(activationRoot, previousProgress);
  activationRoot.querySelectorAll('img:not(.cover-image)').forEach(image => image.addEventListener('error', () => { image.hidden = true; }, { once: true }));
  initialiseCarousel(activationRoot);
  syncTestIndicator(diagnostics);
  motionController?.setNavRoute(store.value.route.name, { animate: transition });
  recordCurrentTitleState(diagnostics, 'home_paint_complete');
  if (tracing) {
    const newCoverCount = activationRoot.querySelectorAll('.cover-image').length;
    diagnostics.event('paint_complete', { route: store.value.route.name, render_mode: renderMode, replacement, transition, restore_requested: Boolean(restore), preserve_scroll: Number.isFinite(preserveScroll), old_cover_count: oldCoverCount, new_cover_count: newCoverCount, covers_reused: reusedCoverCount, covers_recreated: Math.max(0, newCoverCount - reusedCoverCount) });
  }
  if (restore) positionAfterPaint(restoreY, restore === 'startup' ? 'startup_restore' : 'route_return_restore', restoreRoute, renderMode, { save: true });
  else if (Number.isFinite(positionY)) positionAfterPaint(positionY, positionReason, { ...store.value.route }, renderMode);
  else if (Number.isFinite(preserveScroll)) positionAfterPaint(preserveScroll, 'refresh_preserve', { ...store.value.route }, renderMode);
}

async function renderRoute(route, { mode = 'navigation', detail = null, restoreY = null } = {}) {
  const priorRoute = { ...store.value.route };
  const routeChanged = !sameRoute(priorRoute, route);
  const routeRestoreY = Number.isFinite(restoreY) ? restoreY : store.scrollFor(route.name);
  if (mode === 'noop' && !routeChanged) { diagnostics.event('route_render_noop', { route: route.name, book_id: route.bookId || null, mode }); return; }
  const preservedY = mode === 'refresh' ? window.scrollY : null;
  const transition = mode === 'navigation' && routeChanged && !skipNextRouteTransition;
  skipNextRouteTransition = false;
  const version = store.beginRender();
  diagnostics.event('route_render_start', { route: route.name, book_id: route.bookId || null, mode, render_generation: version, route_changed: routeChanged });
  store.setRoute(route);
  if (!store.value.session) { paint(authView(store.value.authMode), { renderMode: mode }); diagnostics.event('route_render_complete', { route: route.name, mode, render_generation: version }); return; }
  if (!store.value.books.length) { paint(claimView(), { renderMode: mode }); diagnostics.event('route_render_complete', { route: route.name, mode, render_generation: version }); return; }

  if (route.name === 'book') {
    const seed = currentBook(route.bookId);
    if (!seed) { diagnostics.event('route_render_cancelled', { route: route.name, mode, render_generation: version, reason: 'missing_book' }); router.navigate({ name: 'library' }, { replace: true }); return; }
    const paintedLoading = !detail && store.value.detail?.book?.id !== route.bookId && mode === 'navigation';
    if (paintedLoading) paint(loadingBookView(seed), { transition, positionY: 0, positionReason: 'book_open_top', lockScrollAnchor: true, renderMode: mode });
    try {
      const loadStarted = performance.now();
      diagnostics.event('book_detail_load_start', { book_id: route.bookId });
      const nextDetail = detail || await loadBookDetail(route.bookId);
      diagnostics.event('book_detail_load_complete', { book_id: route.bookId, duration_ms: Math.round(performance.now() - loadStarted) });
      if (!store.isCurrent(version) || store.value.route.name !== 'book' || store.value.route.bookId !== route.bookId) { diagnostics.event('route_render_cancelled', { route: route.name, mode, render_generation: version, reason: 'stale_render' }); return; }
      store.value.detail = nextDetail;
      store.value.route.returnTo = previousRoute;
      paint(bookDetailView(store.value), { preserveScroll: preservedY, positionY: !paintedLoading && routeChanged ? 0 : null, positionReason: 'book_open_top', lockScrollAnchor: !paintedLoading && routeChanged, reuseCovers: mode === 'refresh' || paintedLoading, transition: transition && !paintedLoading, renderMode: mode });
      diagnostics.event('route_render_complete', { route: route.name, mode, render_generation: version });
      maybeEnrich(nextDetail, version);
    } catch (error) {
      diagnostics.event('book_detail_load_failed', { book_id: route.bookId, name: error?.name, message: error?.message });
      if (store.isCurrent(version)) paint(errorView(error.message || 'Could not load this book'), { renderMode: mode });
    }
    return;
  }

  store.value.detail = null;
  const options = mode === 'navigation'
    ? { restore: true, restoreY: routeRestoreY, transition, renderMode: mode }
    : mode === 'startup'
      ? { restore: 'startup', restoreY: routeRestoreY, renderMode: mode }
      : { preserveScroll: preservedY, reuseCovers: true, renderMode: mode };
  if (route.name === 'home') paint(homeView(store.value), options);
  else if (route.name === 'library' || route.name === 'wishlist') paint(libraryView(store.value, route.name), options);
  else paint(statsView(store.value), options);
  diagnostics.event('route_render_complete', { route: route.name, mode, render_generation: version });
}

async function loadSnapshot() {
  if (!store.value.session) { diagnostics.event('snapshot_load_skipped', { reason: 'no_session' }); return; }
  if (dataLoad) { diagnostics.event('request_deduped', { request_key: 'app-library-snapshot' }); return dataLoad; }
  const started = performance.now();
  diagnostics.event('snapshot_load_start');
  dataLoad = refreshLibrary().then(snapshot => {
    store.update(snapshot);
    libraryLoaded = true;
    diagnostics.event('snapshot_load_complete', { duration_ms: Math.round(performance.now() - started), book_count: snapshot.books.length });
    return snapshot;
  }).catch(error => { diagnostics.event('snapshot_load_failed', { duration_ms: Math.round(performance.now() - started), name: error?.name, message: error?.message }); throw error; }).finally(() => { dataLoad = null; });
  return dataLoad;
}

async function refresh({ quiet = false, scope = 'library', bookId = null } = {}) {
  const routeAtStart = { ...store.value.route };
  const started = performance.now();
  diagnostics.event('refresh_start', { scope, book_id: bookId, route: routeAtStart.name });
  try {
    if (scope === 'book' && routeAtStart.name === 'book' && routeAtStart.bookId === bookId) {
      const before = detailFingerprint(store.value.detail);
      clearRequestDedupe();
      const detail = await loadBookDetail(bookId);
      if (!sameRoute(store.value.route, routeAtStart)) { diagnostics.event('refresh_skipped', { reason: 'route_changed', scope }); return; }
      store.value.detail = detail;
      store.value.books = store.value.books.map(book => book.id === bookId ? detail.book : book);
      if (before !== detailFingerprint(detail)) { diagnostics.event('snapshot_changed', { scope: 'book', book_id: bookId }); await renderRoute(routeAtStart, { mode: 'refresh', detail }); }
      else diagnostics.event('snapshot_unchanged', { scope: 'book', book_id: bookId });
    } else {
      const before = snapshotFingerprint(store.value);
      await loadSnapshot();
      if (!sameRoute(store.value.route, routeAtStart)) { diagnostics.event('refresh_skipped', { reason: 'route_changed', scope }); return; }
      if (before !== snapshotFingerprint(store.value)) { diagnostics.event('snapshot_changed', { scope: 'library' }); await renderRoute(routeAtStart, { mode: 'refresh' }); }
      else diagnostics.event('snapshot_unchanged', { scope: 'library' });
    }
    diagnostics.event('refresh_complete', { scope, duration_ms: Math.round(performance.now() - started) });
    if (!quiet) toast('Library refreshed.');
  } catch (error) { diagnostics.event('refresh_failed', { scope, duration_ms: Math.round(performance.now() - started), name: error?.name, message: error?.message }); toast(error.message || 'Could not refresh library', true); }
}

function maybeEnrich(detail, renderVersion) {
  const book = detail.book;
  if (!navigator.onLine || (book.synopsis && book.cover_url && book.display_edition_id && detail.ratings.length)) return;
  const key = `reading-room-enrich:${book.id}`;
  const last = Number(sessionStorage.getItem(key) || 0);
  if (Date.now() - last < 6 * 60 * 60 * 1000) return;
  sessionStorage.setItem(key, String(Date.now()));
  invoke('book-background-enrich', { book_id: book.id }).then(async () => {
    if (!store.isCurrent(renderVersion) || store.value.route.bookId !== book.id) return;
    await refresh({ quiet: true, scope: 'book', bookId: book.id });
  }).catch(error => console.info('[Reading Room] background enrichment deferred:', error?.message || error));
}

function navigate(route) {
  const restoreY = store.scrollFor(route.name);
  saveCurrentScroll();
  if (!sameRoute(store.value.route, route)) {
    scrollTrackingSuspended = true;
    motionController?.suspend({ expand: true });
  }
  if (route.name === 'book') {
    previousRoute = ['home', 'library', 'wishlist'].includes(store.value.route.name) ? store.value.route.name : previousRoute;
    bookHasReturnRoute = store.value.route.name !== 'book';
  }
  diagnostics.event('route_navigation_requested', { from: store.value.route.name, from_book_id: store.value.route.bookId || null, to: route.name, to_book_id: route.bookId || null, source: 'app_navigation' });
  router.navigate(route, { restoreY });
}

app.addEventListener('click', async event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const route = target.closest('[data-route]');
  if (route) { navigate({ name: route.dataset.route, bookId: null }); return; }
  const open = target.closest('[data-open-book]');
  if (open && !target.closest('[data-progress]')) { navigate({ name: 'book', bookId: open.dataset.openBook }); return; }
  if (target.closest('[data-back]')) {
    scrollTrackingSuspended = true;
    motionController?.suspend({ expand: true });
    if (bookHasReturnRoute) { bookHasReturnRoute = false; history.back(); } else navigate({ name: previousRoute });
    return;
  }
  if (target.closest('[data-refresh]')) { refresh(); return; }
  if (target.closest('[data-menu]')) { openMenu(); return; }
  if (target.closest('[data-signout]')) { supabase.auth.signOut(); return; }
  if (target.closest('[data-add-book]')) { openAddBook(); return; }
  if (target.closest('[data-upnext-id]')) { openUpNextDetails(store.value.upNext.find(item => String(item.queue_id || item.id) === target.closest('[data-upnext-id]').dataset.upnextId), store.value.books); return; }
  if (target.closest('[data-manage-upnext]')) { openUpNextManager(store.value.upNext, store.value.books); return; }
  if (target.closest('[data-recommendation-id]')) { openRecommendation(store.value.aiRecommendations.find(item => item.recommendation_id === target.closest('[data-recommendation-id]').dataset.recommendationId)); return; }
  if (target.closest('[data-recommendations-page]')) { openRecommendationsPage(store.value.aiRecommendations); return; }
  const book = currentBook();
  if (target.closest('[data-progress]')) { openProgress(currentBook(target.closest('[data-progress]').dataset.progress)); return; }
  if (!book) return;
  if (target.closest('[data-start]')) openStart(book);
  else if (target.closest('[data-finish]')) openFinish(book);
  else if (target.closest('[data-pause]')) confirmPause(book);
  else if (target.closest('[data-dnf]')) openDnf(book);
  else if (target.closest('[data-wishlist]')) addToWishlist(book, target.closest('[data-wishlist]'));
  else if (target.closest('[data-review]')) openReview(book);
  else if (target.closest('[data-page-count]')) openPageCount(book);
  else if (target.closest('[data-cover-picker]')) openCoverPicker(book);
  else if (target.closest('[data-refresh-metadata]')) refreshMetadata(book, target.closest('[data-refresh-metadata]'));
  else if (target.closest('[data-book-admin]')) openBookAdmin(book.id);
  else if (target.closest('[data-editions]')) openEditionBrowser(book.id);
  else if (target.closest('[data-copy-verify]')) handleExactCopyAction('verify', book.id);
  else if (target.closest('[data-copy-confirm-pages]')) handleExactCopyAction('confirm-pages', book.id);
  else if (target.closest('[data-copy-photo]')) handleExactCopyAction('photo', book.id);
  else if (target.closest('[data-quote-scan]')) handleQuoteAction('scan', book);
  else if (target.closest('[data-quote-add]')) handleQuoteAction('add', book);
  else if (target.closest('[data-quote-edit]')) handleQuoteAction('edit', book, store.value.detail.quotes.find(quote => quote.id === target.closest('[data-quote-edit]').dataset.quoteEdit));
  else if (target.closest('[data-quote-delete]')) handleQuoteAction('delete', book, store.value.detail.quotes.find(quote => quote.id === target.closest('[data-quote-delete]').dataset.quoteDelete));
  else if (target.closest('[data-synopsis]')) toggleSynopsis(target.closest('[data-synopsis]'));
});

app.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key)) return;
  const item = event.target.closest('[data-open-book],[data-upnext-id],[data-recommendation-id]');
  if (item) { event.preventDefault(); item.click(); }
});

app.addEventListener('input', event => {
  const input = event.target.closest('[data-library-search]');
  if (!input) return;
  const name = input.dataset.librarySearch;
  store.value.queries[name] = input.value;
  const selection = input.selectionStart;
  paint(libraryView(store.value, name), { preserveScroll: window.scrollY, reuseCovers: true });
  const next = app.querySelector('[data-library-search]'); next?.focus(); next?.setSelectionRange(selection, selection);
});

app.addEventListener('click', event => {
  const filter = event.target.closest('[data-filter]');
  if (!filter) return;
  store.value.filters.library = filter.dataset.filter;
  paint(libraryView(store.value, 'library'), { preserveScroll: window.scrollY, reuseCovers: true });
});

app.addEventListener('click', event => {
  const mode = event.target.closest('[data-auth-mode]');
  if (!mode) return;
  store.value.authMode = mode.dataset.authMode;
  paint(authView(store.value.authMode));
});

app.addEventListener('submit', async event => {
  if (event.target.id === 'auth-form') {
    event.preventDefault(); const button = event.target.querySelector('[type="submit"]'); button.disabled = true;
    const result = store.value.authMode === 'signup' ? await supabase.auth.signUp({ email: event.target.email.value.trim(), password: event.target.password.value }) : await supabase.auth.signInWithPassword({ email: event.target.email.value.trim(), password: event.target.password.value });
    if (result.error) { toast(result.error.message, true); button.disabled = false; }
    else if (store.value.authMode === 'signup' && !result.data.session) { toast('Account created. Confirm your email, then sign in.'); store.value.authMode = 'signin'; paint(authView('signin')); }
  }
  if (event.target.id === 'claim-form') {
    event.preventDefault();
    try { await rpc('claim_library', { p_claim_code: event.target['claim-code'].value }); toast('Library claimed.'); await refresh({ quiet: true }); }
    catch (error) { toast(error.message || 'Could not claim library', true); }
  }
});

function toggleSynopsis(button) {
  const text = button.closest('p').querySelector('.synopsis-text');
  const expanded = button.dataset.expanded === '1';
  text.textContent = expanded ? button.dataset.short : button.dataset.full;
  button.textContent = expanded ? 'Read more' : 'Show less';
  button.dataset.expanded = expanded ? '0' : '1';
}

function openMenu() {
  document.querySelector('.sidebar-backdrop')?.remove();
  const wrapper = document.createElement('div'); wrapper.className = 'sidebar-backdrop';
  wrapper.innerHTML = `<aside class="sidebar-panel"><div class="sidebar-head"><h2>Reading Room</h2><button class="icon-btn" data-side-close>×</button></div><section class="sidebar-section"><h3>Library tools</h3><div class="sidebar-actions"><button class="btn" data-side-add>Add book</button><button class="btn" data-side-refresh>Refresh library data</button></div></section>${diagnosticsMenuMarkup(diagnostics)}<section class="sidebar-section"><div class="sidebar-actions"><button class="btn btn-danger" data-side-logout>Log out</button></div></section></aside>`;
  document.body.append(wrapper);
  if (diagnostics.isEnabled()) diagnostics.listSessions().then(sessions => {
    const slot = wrapper.querySelector('[data-diag-history]');
    if (slot) slot.innerHTML = diagnosticHistoryMarkup(sessions, diagnostics.snapshot().id);
  }).catch(() => {});
  wrapper.addEventListener('click', async event => {
    if (event.target === wrapper || event.target.closest('[data-side-close]')) wrapper.remove();
    else if (event.target.closest('[data-side-add]')) { wrapper.remove(); openAddBook(); }
    else if (event.target.closest('[data-side-refresh]')) { wrapper.remove(); refresh(); }
    else if (event.target.closest('[data-side-logout]')) supabase.auth.signOut();
    else if (event.target.closest('[data-diag-enable]')) {
      await diagnostics.enable(); startDiagnosticRuntime(); await diagnostics.setUserId(store.value.session?.user?.id);
      syncTestIndicator(diagnostics); wrapper.remove(); openMenu();
    } else if (event.target.closest('[data-diag-start]')) {
      await diagnostics.startSession(); await diagnostics.setUserId(store.value.session?.user?.id); startDiagnosticRuntime();
      syncTestIndicator(diagnostics); wrapper.remove(); openMenu();
    } else if (event.target.closest('[data-diag-mark]')) openIssueMarker(diagnostics);
    else if (event.target.closest('[data-diag-copy]')) {
      await navigator.clipboard?.writeText(diagnostics.snapshot().session_code || ''); toast('Session code copied.');
    } else if (event.target.closest('[data-diag-copy-session]')) {
      await navigator.clipboard?.writeText(event.target.closest('[data-diag-copy-session]').dataset.diagCopySession); toast('Session code copied.');
    } else if (event.target.closest('[data-diag-retry]')) {
      try { const result = await diagnostics.upload(event.target.closest('[data-diag-retry]').dataset.diagRetry); toast(`Diagnostic session uploaded · ${result.session_code}`); }
      catch (error) { toast(error.message || 'Diagnostic upload failed.', true); }
      wrapper.remove(); openMenu();
    } else if (event.target.closest('[data-diag-end]')) {
      await requestServiceWorkerDiagnosticSnapshot(diagnostics).catch(() => {});
      await diagnostics.endSession(); syncTestIndicator(diagnostics); wrapper.remove(); openMenu();
    } else if (event.target.closest('[data-diag-upload]')) {
      await requestServiceWorkerDiagnosticSnapshot(diagnostics).catch(() => {});
      const session = await diagnostics.endSession();
      try { const result = await diagnostics.upload(session.id); toast(`Diagnostic session uploaded · ${result.session_code}`); }
      catch (error) { toast(error.message || 'Diagnostic upload failed. Retry from Test Mode.', true); }
      syncTestIndicator(diagnostics); wrapper.remove(); openMenu();
    } else if (event.target.closest('[data-diag-disable]')) {
      await diagnostics.disable(); stopDiagnosticRuntime(); syncTestIndicator(diagnostics); wrapper.remove(); openMenu();
    }
  });
}

window.addEventListener('reading-room:refresh', event => refresh({
  quiet: true,
  scope: event.detail?.scope || (store.value.route.name === 'book' ? 'book' : 'library'),
  bookId: event.detail?.bookId || (store.value.route.name === 'book' ? store.value.route.bookId : null)
}));

async function init() {
  diagnostics.event('app_init_start');
  router = createRouter((route, context) => renderRoute(route, {
    mode: context.source === 'start' ? 'startup' : context.source === 'same-route' ? 'noop' : 'navigation',
    restoreY: context.restoreY
  }), diagnostics);
  diagnostics.event('auth_get_session_start');
  const { data: { session } } = await supabase.auth.getSession();
  diagnostics.event('auth_get_session_complete', { has_session: Boolean(session) });
  store.value.session = session;
  if (diagnostics.isEnabled()) await diagnostics.setUserId(session?.user?.id);
  if (session) {
    diagnostics.event('auth_bootstrap_started', { same_user: true });
    try { await loadSnapshot(); }
    catch (error) { paint(errorView(error.message)); }
    diagnostics.event('auth_bootstrap_complete', { has_library: libraryLoaded });
  } else diagnostics.event('auth_bootstrap_skipped', { reason: 'no_session' });
  router.start();
  supabase.auth.onAuthStateChange(async (authEvent, nextSession) => {
    const previousUserId = store.value.session?.user?.id || null;
    const nextUserId = nextSession?.user?.id || null;
    diagnostics.event('auth_state_change', { event_name: authEvent, previous_user_equals_new: previousUserId === nextUserId, had_user: Boolean(previousUserId), has_user: Boolean(nextUserId) });
    const enteringSession = !store.value.session && Boolean(nextSession);
    store.value.session = nextSession;
    if (diagnostics.isEnabled()) await diagnostics.setUserId(nextUserId);
    if (!nextSession) {
      libraryLoaded = false;
      sessionBootstrapUser = null;
      store.update({ books: [], recommendations: [], aiRecommendations: [], upNext: [], chapters: [], detail: null });
      paint(authView(store.value.authMode));
      return;
    }
    if (previousUserId !== nextUserId || !libraryLoaded) {
      if (sessionBootstrapUser === nextUserId) { diagnostics.event('auth_bootstrap_skipped', { reason: 'already_in_progress' }); return; }
      sessionBootstrapUser = nextUserId;
      diagnostics.event('auth_bootstrap_started', { entering_session: enteringSession, same_user: previousUserId === nextUserId });
      try {
        await loadSnapshot();
        if (store.value.session?.user?.id !== nextUserId) return;
        await renderRoute({ ...store.value.route }, { mode: enteringSession ? 'startup' : 'refresh' });
        diagnostics.event('auth_bootstrap_complete', { entering_session: enteringSession });
      } catch (error) { diagnostics.event('auth_bootstrap_failed', { name: error?.name, message: error?.message }); paint(errorView(error.message)); }
      finally { if (sessionBootstrapUser === nextUserId) sessionBootstrapUser = null; }
    }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').then(registration => {
    serviceWorkerRegistration = registration;
    connectServiceWorkerDiagnostics(diagnostics, registration).catch(() => {});
  }).catch(error => console.info('[Reading Room] service worker unavailable:', error?.message || error));
  diagnostics.event('app_init_complete');
}

installScrollLifecycle({
  getRoute: () => store.value.route,
  save: (name, y) => store.saveScroll(name, y),
  cancelRestore: cancelScrollRestore,
  isSuspended: () => scrollTrackingSuspended
});

motionController = installMotionController({
  getRoute: () => store.value.route,
  goBack: () => {
    skipNextRouteTransition = true;
    app.querySelector('[data-back]')?.click();
  }
});

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

async function boot() {
  if (diagnostics.isEnabled()) { await diagnostics.initialize(); startDiagnosticRuntime(); }
  await init();
}

boot();
