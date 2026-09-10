import { supabase } from './data/supabase.js';
import { clearRequestDedupe, invoke, loadBookDetail, refreshLibrary, rpc } from './data/library.js';
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
import { activateCovers, collectCoverImages, reuseCoverImages } from './ui/cover.js';

const app = document.querySelector('#app');
const store = createAppState();
let router;
let previousRoute = 'home';
let bookHasReturnRoute = false;
let dataLoad = null;
let libraryLoaded = false;
let scrollRestoreFrame = null;
let sessionBootstrapUser = null;

function currentBook(id = store.value.route.bookId) {
  return store.value.detail?.book?.id === id ? store.value.detail.book : store.value.books.find(book => book.id === id);
}

function saveCurrentScroll() {
  const name = store.value.route.name;
  if (['home', 'library', 'wishlist'].includes(name)) store.saveScroll(name, window.scrollY);
}

function paint(html, { restore = false, preserveScroll = null, reuseCovers = false } = {}) {
  if (scrollRestoreFrame !== null) {
    cancelAnimationFrame(scrollRestoreFrame);
    scrollRestoreFrame = null;
  }
  const coverPool = reuseCovers ? collectCoverImages(app) : null;
  app.innerHTML = html;
  app.dataset.routeView = store.value.route.name;
  if (coverPool) reuseCoverImages(app, coverPool);
  else activateCovers(app);
  app.querySelectorAll('img:not(.cover-image)').forEach(image => image.addEventListener('error', () => { image.hidden = true; }, { once: true }));
  initialiseCarousel(app);
  if (restore) {
    const route = { ...store.value.route };
    const y = store.scrollFor(route.name);
    scrollRestoreFrame = requestAnimationFrame(() => {
      scrollRestoreFrame = null;
      if (sameRoute(store.value.route, route)) window.scrollTo({ top: y, left: 0, behavior: 'instant' });
    });
  }
  else if (Number.isFinite(preserveScroll)) window.scrollTo({ top: preserveScroll, left: 0, behavior: 'instant' });
}

async function renderRoute(route, { mode = 'navigation', detail = null } = {}) {
  const priorRoute = { ...store.value.route };
  const routeChanged = !sameRoute(priorRoute, route);
  const preservedY = mode === 'refresh' ? window.scrollY : null;
  const version = store.beginRender();
  store.setRoute(route);
  if (!store.value.session) { paint(authView(store.value.authMode)); return; }
  if (!store.value.books.length) { paint(claimView()); return; }

  if (route.name === 'book') {
    const seed = currentBook(route.bookId);
    if (!seed) { router.navigate({ name: 'library' }, { replace: true }); return; }
    if (mode === 'navigation' && routeChanged) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    if (!detail && store.value.detail?.book?.id !== route.bookId && mode === 'navigation') paint(loadingBookView(seed));
    try {
      const nextDetail = detail || await loadBookDetail(route.bookId);
      if (!store.isCurrent(version) || store.value.route.name !== 'book' || store.value.route.bookId !== route.bookId) return;
      store.value.detail = nextDetail;
      store.value.route.returnTo = previousRoute;
      paint(bookDetailView(store.value), { preserveScroll: preservedY, reuseCovers: mode === 'refresh' });
      maybeEnrich(nextDetail, version);
    } catch (error) {
      if (store.isCurrent(version)) paint(errorView(error.message || 'Could not load this book'));
    }
    return;
  }

  store.value.detail = null;
  const options = mode === 'navigation'
    ? { restore: true }
    : { preserveScroll: preservedY, reuseCovers: true };
  if (route.name === 'home') paint(homeView(store.value), options);
  else if (route.name === 'library' || route.name === 'wishlist') paint(libraryView(store.value, route.name), options);
  else paint(statsView(store.value), options);
}

async function loadSnapshot() {
  if (!store.value.session) return;
  if (dataLoad) return dataLoad;
  dataLoad = refreshLibrary().then(snapshot => {
    store.update(snapshot);
    libraryLoaded = true;
    return snapshot;
  }).finally(() => { dataLoad = null; });
  return dataLoad;
}

async function refresh({ quiet = false, scope = 'library', bookId = null } = {}) {
  const routeAtStart = { ...store.value.route };
  try {
    if (scope === 'book' && routeAtStart.name === 'book' && routeAtStart.bookId === bookId) {
      const before = detailFingerprint(store.value.detail);
      clearRequestDedupe();
      const detail = await loadBookDetail(bookId);
      if (!sameRoute(store.value.route, routeAtStart)) return;
      store.value.detail = detail;
      store.value.books = store.value.books.map(book => book.id === bookId ? detail.book : book);
      if (before !== detailFingerprint(detail)) await renderRoute(routeAtStart, { mode: 'refresh', detail });
    } else {
      const before = snapshotFingerprint(store.value);
      await loadSnapshot();
      if (!sameRoute(store.value.route, routeAtStart)) return;
      if (before !== snapshotFingerprint(store.value)) await renderRoute(routeAtStart, { mode: 'refresh' });
    }
    if (!quiet) toast('Library refreshed.');
  } catch (error) { toast(error.message || 'Could not refresh library', true); }
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
  saveCurrentScroll();
  if (route.name === 'book') {
    previousRoute = ['home', 'library', 'wishlist'].includes(store.value.route.name) ? store.value.route.name : previousRoute;
    bookHasReturnRoute = store.value.route.name !== 'book';
  }
  router.navigate(route);
}

app.addEventListener('click', async event => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const route = target.closest('[data-route]');
  if (route) { navigate({ name: route.dataset.route, bookId: null }); return; }
  const open = target.closest('[data-open-book]');
  if (open && !target.closest('[data-progress]')) { navigate({ name: 'book', bookId: open.dataset.openBook }); return; }
  if (target.closest('[data-back]')) { if (bookHasReturnRoute) { bookHasReturnRoute = false; history.back(); } else router.navigate({ name: previousRoute }); return; }
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
  else if (target.closest('[data-wishlist]')) addToWishlist(book);
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
  paint(libraryView(store.value, name));
  const next = app.querySelector('[data-library-search]'); next?.focus(); next?.setSelectionRange(selection, selection);
});

app.addEventListener('click', event => {
  const filter = event.target.closest('[data-filter]');
  if (!filter) return;
  store.value.filters.library = filter.dataset.filter;
  paint(libraryView(store.value, 'library'));
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
  wrapper.innerHTML = `<aside class="sidebar-panel"><div class="sidebar-head"><h2>Reading Room</h2><button class="icon-btn" data-side-close>×</button></div><section class="sidebar-section"><h3>Library tools</h3><div class="sidebar-actions"><button class="btn" data-side-add>Add book</button><button class="btn" data-side-refresh>Refresh library data</button></div></section><section class="sidebar-section"><div class="sidebar-actions"><button class="btn btn-danger" data-side-logout>Log out</button></div></section></aside>`;
  document.body.append(wrapper);
  wrapper.addEventListener('click', event => {
    if (event.target === wrapper || event.target.closest('[data-side-close]')) wrapper.remove();
    else if (event.target.closest('[data-side-add]')) { wrapper.remove(); openAddBook(); }
    else if (event.target.closest('[data-side-refresh]')) { wrapper.remove(); refresh(); }
    else if (event.target.closest('[data-side-logout]')) supabase.auth.signOut();
  });
}

window.addEventListener('reading-room:refresh', event => refresh({
  quiet: true,
  scope: event.detail?.scope || (store.value.route.name === 'book' ? 'book' : 'library'),
  bookId: event.detail?.bookId || (store.value.route.name === 'book' ? store.value.route.bookId : null)
}));

async function init() {
  router = createRouter(route => renderRoute(route));
  const { data: { session } } = await supabase.auth.getSession();
  store.value.session = session;
  if (session) {
    try { await loadSnapshot(); }
    catch (error) { paint(errorView(error.message)); }
  }
  router.start();
  supabase.auth.onAuthStateChange(async (_event, nextSession) => {
    const previousUserId = store.value.session?.user?.id || null;
    const nextUserId = nextSession?.user?.id || null;
    const enteringSession = !store.value.session && Boolean(nextSession);
    store.value.session = nextSession;
    if (!nextSession) {
      libraryLoaded = false;
      sessionBootstrapUser = null;
      store.update({ books: [], recommendations: [], aiRecommendations: [], upNext: [], chapters: [], detail: null });
      paint(authView(store.value.authMode));
      return;
    }
    if (previousUserId !== nextUserId || !libraryLoaded) {
      if (sessionBootstrapUser === nextUserId) return;
      sessionBootstrapUser = nextUserId;
      try {
        await loadSnapshot();
        if (store.value.session?.user?.id !== nextUserId) return;
        await renderRoute({ ...store.value.route }, { mode: enteringSession ? 'navigation' : 'refresh' });
      } catch (error) { paint(errorView(error.message)); }
      finally { if (sessionBootstrapUser === nextUserId) sessionBootstrapUser = null; }
    }
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(error => console.info('[Reading Room] service worker unavailable:', error?.message || error));
}

init();
