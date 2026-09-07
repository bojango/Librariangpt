import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastNode = document.querySelector('#toast');

const state = {
  session: null,
  books: [],
  recommendations: [],
  page: 'home',
  detailId: null,
  filter: 'All',
  query: '',
  authMode: 'signin'
};

const FILTERS = ['All', 'Owned', 'Unread', 'Read', 'Wishlist', 'Recommended'];

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function fmtDate(value) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function coverPalette(title = '') {
  let h = 2166136261;
  for (const ch of title) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const palettes = [
    ['#59422d','#1d1917'], ['#2f4c48','#151c1b'], ['#4a3c54','#19161d'], ['#59404a','#1d1619'],
    ['#3e4a2f','#171b13'], ['#36506a','#141a20'], ['#6a5134','#201912'], ['#4d4439','#171512']
  ];
  return palettes[Math.abs(h) % palettes.length];
}

function cover(book, extraClass = '') {
  const [a, b] = coverPalette(book.title);
  const image = book.cover_url
    ? `<img src="${esc(book.cover_url)}" alt="Cover of ${esc(book.title)}" loading="lazy" onerror="this.remove()">`
    : '';
  return `<div class="cover ${extraClass}" style="--cover-a:${a};--cover-b:${b}">${image}<div class="cover-fallback"><small>${esc(book.primary_genre || 'Library')}</small><strong>${esc(book.title)}</strong></div></div>`;
}

function progressPct(book) {
  const p = Number(book.progress_percent);
  return Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : 0;
}

function progressText(book) {
  if (book.current_page == null && book.total_pages == null) return 'Progress not recorded';
  if (book.total_pages == null) return `Page ${book.current_page ?? 0}`;
  return `Page ${book.current_page ?? 0} of ${book.total_pages}`;
}

function recommendationFor(bookId) {
  return state.recommendations.find(r => r.book_id === bookId) || null;
}

function bookCard(book) {
  return `<article class="book-card" data-book-id="${book.id}" tabindex="0" role="button" aria-label="Open ${esc(book.title)}">
    ${cover(book)}
    <div class="book-title">${esc(book.title)}</div>
    <div class="book-author">${esc(book.authors || 'Unknown author')}</div>
  </article>`;
}

function shelf(title, books, action = '') {
  return `<section class="section">
    <div class="section-header"><h2>${esc(title)}</h2>${action ? `<button data-nav="${action}">View all</button>` : ''}</div>
    ${books.length ? `<div class="shelf">${books.map(bookCard).join('')}</div>` : '<div class="empty-shelf">Nothing here yet.</div>'}
  </section>`;
}

function nav(active) {
  const items = [
    ['home','⌂','Home'], ['library','▦','Library'], ['wishlist','♡','Wishlist'], ['stats','◴','Stats']
  ];
  return `<nav class="bottom-nav" aria-label="Main navigation">${items.map(([key, icon, label]) =>
    `<button class="nav-btn ${active === key ? 'active' : ''}" data-nav="${key}"><span>${icon}</span><span>${label}</span></button>`
  ).join('')}</nav>`;
}

function chrome(content, active = state.page) {
  return `<div class="layout">
    <header class="topbar">
      <div class="wordmark"><div class="brand-mark">L</div><span>LibrarianGPT</span></div>
      <div class="top-actions"><button class="icon-btn" id="refresh" aria-label="Refresh">↻</button><button class="icon-btn" id="signout" aria-label="Sign out">↪</button></div>
    </header>
    <main>${content}</main>
    ${nav(active)}
  </div>`;
}

function authView() {
  const signup = state.authMode === 'signup';
  app.innerHTML = `<section class="auth-shell"><div class="auth-card">
    <div class="brand-mark">L</div>
    <h1>Your library.</h1>
    <p>A private reading terminal for progress, shelves and the occasional proof that you have, in fact, finished a book.</p>
    <div class="auth-tabs"><button data-auth-mode="signin" class="${signup ? '' : 'active'}">Sign in</button><button data-auth-mode="signup" class="${signup ? 'active' : ''}">Create account</button></div>
    <form id="auth-form" class="form-stack">
      <div class="field"><label for="email">Email</label><input class="input" id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="password">Password</label><input class="input" id="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required></div>
      <button class="btn btn-primary btn-full" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <p class="auth-note">Library data is protected by Supabase authentication and database Row Level Security.</p>
  </div></section>`;

  app.querySelectorAll('[data-auth-mode]').forEach(btn => btn.addEventListener('click', () => {
    state.authMode = btn.dataset.authMode;
    authView();
  }));
  app.querySelector('#auth-form').addEventListener('submit', handleAuth);
}

async function handleAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const email = form.email.value.trim();
  const password = form.password.value;
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const result = state.authMode === 'signup'
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) throw result.error;
    if (state.authMode === 'signup' && !result.data.session) {
      toast('Account created. Confirm your email, then sign in.');
      state.authMode = 'signin';
      authView();
    }
  } catch (error) {
    toast(error.message || 'Authentication failed', true);
  } finally {
    button.disabled = false;
  }
}

function claimView() {
  app.innerHTML = `<section class="auth-shell"><div class="auth-card">
    <div class="brand-mark">L</div>
    <h1>Claim your library.</h1>
    <p>The migrated catalogue is waiting for its owner. Enter the one-time claim code created during migration. It is invalidated after a successful claim.</p>
    <form id="claim-form" class="form-stack">
      <div class="field"><label for="claim-code">One-time claim code</label><input class="input" id="claim-code" type="password" autocomplete="off" required></div>
      <button class="btn btn-primary btn-full" type="submit">Claim library</button>
      <button class="btn btn-quiet btn-full" id="claim-signout" type="button">Sign out</button>
    </form>
  </div></section>`;
  app.querySelector('#claim-form').addEventListener('submit', handleClaim);
  app.querySelector('#claim-signout').addEventListener('click', () => supabase.auth.signOut());
}

async function handleClaim(event) {
  event.preventDefault();
  const code = event.currentTarget['claim-code'].value;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const { error } = await supabase.rpc('claim_library', { p_claim_code: code });
    if (error) throw error;
    toast('Library claimed.');
    await loadData();
  } catch (error) {
    toast(error.message || 'Could not claim library', true);
    button.disabled = false;
  }
}

async function loadData(force = false) {
  if (!state.session) return;
  const { data: books, error } = await supabase.from('v_library').select('*').order('title');
  if (error) throw error;
  if (!books?.length) {
    state.books = [];
    claimView();
    return;
  }
  state.books = books;
  const recResult = await supabase.from('recommendations')
    .select('book_id,recommendation_strength,match_score_10,recommendation_status,why_recommended,frontend_featured,frontend_shelf,user_interest,prediction_accuracy_5,outcome')
    .order('match_score_10', { ascending: false, nullsFirst: false });
  if (recResult.error) throw recResult.error;
  state.recommendations = recResult.data || [];
  if (force && state.detailId && !state.books.some(b => b.id === state.detailId)) state.detailId = null;
  render();
}

function homeView() {
  const current = state.books.filter(b => b.overall_status === 'Currently Reading');
  const unread = state.books.filter(b => b.overall_status === 'Owned - Unread').slice(0, 12);
  const wishlist = state.books.filter(b => b.overall_status === 'Wishlist').slice(0, 12);
  const recent = state.books.filter(b => b.overall_status === 'Read')
    .sort((a,b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0)).slice(0, 12);
  const featuredIds = state.recommendations.filter(r => r.frontend_featured && !['Read','Dismissed'].includes(r.recommendation_status)).map(r => r.book_id);
  const featured = featuredIds.map(id => state.books.find(b => b.id === id)).filter(Boolean).slice(0, 12);
  const fallbackRecommended = state.recommendations
    .filter(r => !['Read','Dismissed'].includes(r.recommendation_status))
    .map(r => state.books.find(b => b.id === r.book_id)).filter(Boolean).slice(0, 12);
  const recommendations = featured.length ? featured : fallbackRecommended;

  let hero = '';
  if (current.length) {
    const book = current[0];
    const pct = progressPct(book);
    hero = `<section class="hero" data-book-id="${book.id}">
      ${cover(book)}
      <div class="hero-copy"><p class="eyebrow">Currently reading</p><h1>${esc(book.title)}</h1><div class="hero-author">${esc(book.authors || '')}</div>
        <div class="progress-block"><div class="progress-meta"><span>${esc(progressText(book))}</span><span>${book.total_pages ? `${Math.round(pct)}%` : ''}</span></div><div class="progress-track"><div class="progress-fill" style="--progress:${pct}%"></div></div></div>
        <div class="hero-actions"><button class="btn btn-primary" data-progress="${book.id}">Update progress</button><button class="btn" data-book-id="${book.id}">Open book</button></div>
      </div></section>`;
  } else {
    hero = `<section class="hero"><div class="hero-copy"><p class="eyebrow">Reading terminal</p><h1>Nothing currently open.</h1><div class="hero-author">Your owned-unread shelf is sitting there, judging with remarkable restraint.</div><div class="hero-actions"><button class="btn btn-primary" data-nav="library">Browse library</button></div></div></section>`;
  }

  return chrome(`${hero}${shelf('Owned & unread', unread, 'library')}${shelf('Recommended for you', recommendations, 'library')}${shelf('Wishlist', wishlist, 'wishlist')}${shelf('Recently finished', recent, 'library')}`, 'home');
}

function filteredBooks() {
  let books = [...state.books];
  const q = state.query.trim().toLowerCase();
  if (q) books = books.filter(b => [b.title,b.authors,b.primary_genre,b.series].some(v => String(v || '').toLowerCase().includes(q)));
  switch (state.filter) {
    case 'Owned': books = books.filter(b => b.ownership_status === 'Owned'); break;
    case 'Unread': books = books.filter(b => b.overall_status === 'Owned - Unread'); break;
    case 'Read': books = books.filter(b => b.overall_status === 'Read'); break;
    case 'Wishlist': books = books.filter(b => b.overall_status === 'Wishlist'); break;
    case 'Recommended': {
      const ids = new Set(state.recommendations.filter(r => r.recommendation_status !== 'Dismissed').map(r => r.book_id));
      books = books.filter(b => ids.has(b.id)); break;
    }
  }
  return books.sort((a,b) => a.title.localeCompare(b.title));
}

function libraryView(forceFilter = null) {
  if (forceFilter) state.filter = forceFilter;
  const books = filteredBooks();
  return chrome(`<div class="page-heading"><p class="eyebrow">Catalogue</p><h1>${state.filter === 'All' ? 'Library' : esc(state.filter)}</h1><p>${books.length} ${books.length === 1 ? 'book' : 'books'} in this view.</p></div>
    <div class="toolbar"><input id="library-search" class="input search" type="search" placeholder="Search title, author, genre or series" value="${esc(state.query)}"><div class="filters">${FILTERS.map(f => `<button class="filter ${state.filter === f ? 'active' : ''}" data-filter="${f}">${f}</button>`).join('')}</div></div>
    <div class="library-grid">${books.map(bookCard).join('')}</div>`, state.page === 'wishlist' ? 'wishlist' : 'library');
}

function statsView() {
  const read = state.books.filter(b => b.overall_status === 'Read');
  const year = new Date().getFullYear();
  const thisYear = read.filter(b => b.completed_at && new Date(b.completed_at).getFullYear() === year);
  const ratings = read.map(b => Number(b.user_rating_5)).filter(Number.isFinite);
  const avg = ratings.length ? (ratings.reduce((a,b) => a+b,0) / ratings.length).toFixed(1) : '—';
  const pages = read.reduce((sum,b) => sum + (Number(b.total_pages) || 0), 0);
  return chrome(`<div class="page-heading"><p class="eyebrow">Reading data</p><h1>Stats</h1><p>Useful numbers, generated without requiring you to maintain a spreadsheet like it is 2007.</p></div>
    <div class="stats-grid">
      <div class="stat"><strong>${read.length}</strong><span>Books read</span></div>
      <div class="stat"><strong>${thisYear.length}</strong><span>Finished in ${year}</span></div>
      <div class="stat"><strong>${state.books.filter(b => b.overall_status === 'Currently Reading').length}</strong><span>Currently reading</span></div>
      <div class="stat"><strong>${state.books.filter(b => b.overall_status === 'Owned - Unread').length}</strong><span>Owned & unread</span></div>
      <div class="stat"><strong>${state.books.filter(b => b.overall_status === 'Wishlist').length}</strong><span>Wishlist</span></div>
      <div class="stat"><strong>${avg}</strong><span>Average rating</span></div>
      <div class="stat stat-wide"><strong>${pages ? pages.toLocaleString('en-GB') : '—'}</strong><span>Known pages across completed books</span></div>
    </div>`, 'stats');
}

function detailView(book) {
  const rec = recommendationFor(book.id);
  const pct = progressPct(book);
  const tags = [book.overall_status, book.ownership_status, book.primary_genre, book.edition_format].filter(Boolean);
  const reading = book.overall_status === 'Currently Reading';
  const canStart = ['Owned - Unread','Paused'].includes(book.overall_status) || (book.ownership_status === 'Owned' && !['Currently Reading','Read'].includes(book.overall_status));
  const actions = [
    reading ? `<button class="btn btn-primary" data-progress="${book.id}">Update progress</button>` : '',
    canStart ? `<button class="btn btn-primary" data-start="${book.id}">${book.overall_status === 'Paused' ? 'Resume reading' : 'Start reading'}</button>` : '',
    reading ? `<button class="btn" data-finish="${book.id}">Finish</button><button class="btn" data-pause="${book.id}">Pause</button><button class="btn btn-danger" data-dnf="${book.id}">DNF</button>` : '',
    book.overall_status !== 'Wishlist' && book.ownership_status !== 'Owned' ? `<button class="btn" data-status="wishlist" data-book="${book.id}">Add to wishlist</button>` : ''
  ].join('');

  return chrome(`<button class="back-btn" data-back>← Back</button>
    <section class="detail-header">${cover(book)}<div class="detail-copy">
      <p class="eyebrow">${esc(book.fiction_nonfiction || 'Book')}</p><h1>${esc(book.title)}</h1><div class="hero-author">${esc(book.authors || 'Unknown author')}</div>
      <div class="meta">${tags.map(t => `<span class="badge">${esc(t)}</span>`).join('')}${rec?.match_score_10 != null ? `<span class="badge accent">Predicted fit ${rec.match_score_10}/10</span>` : ''}</div>
      ${book.synopsis ? `<p>${esc(book.synopsis)}</p>` : ''}
      ${reading ? `<div class="progress-block"><div class="progress-meta"><span>${esc(progressText(book))}</span><span>${book.total_pages ? `${Math.round(pct)}%` : ''}</span></div><div class="progress-track"><div class="progress-fill" style="--progress:${pct}%"></div></div></div>` : ''}
      <div class="detail-actions">${actions}</div>
      <div class="info-grid">
        <div class="info"><small>Started</small><strong>${fmtDate(book.started_at)}</strong></div>
        <div class="info"><small>Finished</small><strong>${fmtDate(book.completed_at)}</strong></div>
        <div class="info"><small>Edition</small><strong>${esc([book.publisher,book.edition_year,book.edition_format].filter(Boolean).join(' · ') || 'Not captured')}</strong></div>
        <div class="info"><small>ISBN</small><strong>${esc(book.isbn13 || book.isbn10 || 'Not captured')}</strong></div>
        <div class="info"><small>Rating</small><strong>${book.user_rating_5 != null ? `${book.user_rating_5}/5` : 'Not rated'}</strong></div>
        <div class="info"><small>Series</small><strong>${esc(book.series ? `${book.series}${book.series_order ? ` #${book.series_order}` : ''}` : 'Standalone / none recorded')}</strong></div>
      </div>
      ${rec?.why_recommended ? `<section class="section"><div class="section-header"><h2>Why it was recommended</h2></div><p>${esc(rec.why_recommended)}</p>${rec.outcome ? `<span class="badge">Prediction outcome: ${esc(rec.outcome)}</span>` : ''}</section>` : ''}
      ${book.user_review ? `<section class="section"><div class="section-header"><h2>Your review</h2></div><p>${esc(book.user_review)}</p></section>` : ''}
    </div></section>`, 'library');
}

function render() {
  if (!state.session) return authView();
  if (state.detailId) {
    const book = state.books.find(b => b.id === state.detailId);
    if (book) app.innerHTML = detailView(book); else state.detailId = null;
  }
  if (!state.detailId) {
    if (state.page === 'home') app.innerHTML = homeView();
    else if (state.page === 'library') app.innerHTML = libraryView();
    else if (state.page === 'wishlist') { state.filter = 'Wishlist'; app.innerHTML = libraryView('Wishlist'); }
    else if (state.page === 'stats') app.innerHTML = statsView();
  }
  bindUI();
}

function bindUI() {
  app.querySelector('#refresh')?.addEventListener('click', () => loadData(true).catch(e => toast(e.message, true)));
  app.querySelector('#signout')?.addEventListener('click', () => supabase.auth.signOut());
  app.querySelectorAll('[data-nav]').forEach(btn => btn.addEventListener('click', () => {
    state.page = btn.dataset.nav; state.detailId = null;
    if (state.page !== 'wishlist' && state.page !== 'library') state.filter = 'All';
    render();
  }));
  app.querySelectorAll('[data-book-id]').forEach(node => {
    const open = event => {
      if (event.target.closest('[data-progress]')) return;
      if (event.type === 'keydown' && !['Enter',' '].includes(event.key)) return;
      state.detailId = node.dataset.bookId; render();
    };
    node.addEventListener('click', open); node.addEventListener('keydown', open);
  });
  app.querySelector('[data-back]')?.addEventListener('click', () => { state.detailId = null; render(); });
  app.querySelector('#library-search')?.addEventListener('input', event => { state.query = event.target.value; render(); requestAnimationFrame(() => { const el = app.querySelector('#library-search'); el?.focus(); el?.setSelectionRange(state.query.length,state.query.length); }); });
  app.querySelectorAll('[data-filter]').forEach(btn => btn.addEventListener('click', () => { state.filter = btn.dataset.filter; render(); }));
  app.querySelectorAll('[data-progress]').forEach(btn => btn.addEventListener('click', event => { event.stopPropagation(); openProgress(btn.dataset.progress); }));
  app.querySelectorAll('[data-start]').forEach(btn => btn.addEventListener('click', () => openStart(btn.dataset.start)));
  app.querySelectorAll('[data-finish]').forEach(btn => btn.addEventListener('click', () => openFinish(btn.dataset.finish)));
  app.querySelectorAll('[data-pause]').forEach(btn => btn.addEventListener('click', () => confirmAction('Pause reading?', 'This keeps your reading session and progress, but marks it paused.', 'Pause', () => rpcAction('pause_reading', { p_book_id: btn.dataset.pause, p_source: 'frontend' }, 'Reading paused.'))));
  app.querySelectorAll('[data-dnf]').forEach(btn => btn.addEventListener('click', () => openDnf(btn.dataset.dnf)));
  app.querySelectorAll('[data-status="wishlist"]').forEach(btn => btn.addEventListener('click', () => rpcAction('set_library_status', { p_book_id: btn.dataset.book, p_status: 'Wishlist', p_ownership: null, p_priority: null, p_source: 'frontend' }, 'Added to wishlist.')));
}

function modal(html) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  modalRoot.querySelectorAll('[data-close]').forEach(btn => btn.addEventListener('click', closeModal));
  modalRoot.querySelector('.modal-backdrop')?.addEventListener('click', event => { if (event.target.classList.contains('modal-backdrop')) closeModal(); });
}
function closeModal() { modalRoot.innerHTML = ''; }

function openProgress(id) {
  const book = state.books.find(b => b.id === id); if (!book) return;
  modal(`<h2>Update ${esc(book.title)}</h2><p>${esc(progressText(book))}</p><form id="progress-form" class="form-stack">
    <div class="field"><label for="page">Current page</label><input class="input" id="page" type="number" min="0" ${book.total_pages ? `max="${book.total_pages}"` : ''} value="${book.current_page ?? ''}" required></div>
    <div class="field"><label for="total-pages">Total pages ${book.total_pages ? '(change only if needed)' : '(needed for percentage)'}</label><input class="input" id="total-pages" type="number" min="1" value="${book.total_pages ?? ''}"></div>
    <div class="modal-actions"><button class="btn btn-quiet" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save progress</button></div></form>`);
  modalRoot.querySelector('#progress-form').addEventListener('submit', async e => {
    e.preventDefault();
    const page = Number(e.currentTarget.page.value);
    const total = e.currentTarget['total-pages'].value ? Number(e.currentTarget['total-pages'].value) : null;
    try {
      if (total && total !== Number(book.total_pages)) {
        const setPages = await supabase.rpc('set_reading_page_count', { p_book_id: id, p_total_pages: total, p_source: 'frontend' });
        if (setPages.error) throw setPages.error;
      }
      const result = await supabase.rpc('update_reading_progress', { p_book_id: id, p_page: page, p_source: 'frontend' });
      if (result.error) throw result.error;
      closeModal(); await loadData(true); toast('Progress updated.');
    } catch (error) { toast(error.message || 'Could not update progress', true); }
  });
}

function openStart(id) {
  const book = state.books.find(b => b.id === id); if (!book) return;
  modal(`<h2>Start ${esc(book.title)}</h2><p>The start time is recorded automatically by the database.</p><form id="start-form" class="form-stack">
    <div class="field"><label for="total-pages">Total pages</label><input class="input" id="total-pages" type="number" min="1" value="${book.total_pages ?? ''}" placeholder="Optional if not known yet"></div>
    <div class="modal-actions"><button class="btn btn-quiet" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Start reading</button></div></form>`);
  modalRoot.querySelector('#start-form').addEventListener('submit', async e => {
    e.preventDefault();
    const total = e.currentTarget['total-pages'].value ? Number(e.currentTarget['total-pages'].value) : null;
    await rpcAction('start_reading', { p_book_id: id, p_edition_id: book.current_edition_id || null, p_total_pages: total }, 'Reading started.');
  });
}

function openFinish(id) {
  const book = state.books.find(b => b.id === id); if (!book) return;
  modal(`<h2>Finish ${esc(book.title)}</h2><p>The completion time is recorded automatically. Rating and review are optional; the interesting interrogation can remain in ChatGPT where it belongs.</p><form id="finish-form" class="form-stack">
    <div class="field"><label for="rating">Rating / 5</label><input class="input" id="rating" type="number" min="0" max="5" step="0.5" value="${book.user_rating_5 ?? ''}"></div>
    <div class="field"><label for="review">Short review</label><textarea class="input" id="review" rows="4">${esc(book.user_review || '')}</textarea></div>
    <div class="modal-actions"><button class="btn btn-quiet" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Mark finished</button></div></form>`);
  modalRoot.querySelector('#finish-form').addEventListener('submit', async e => {
    e.preventDefault();
    const rating = e.currentTarget.rating.value ? Number(e.currentTarget.rating.value) : null;
    const review = e.currentTarget.review.value.trim() || null;
    await rpcAction('finish_reading', { p_book_id: id, p_rating: rating, p_review: review, p_source: 'frontend' }, 'Book finished.');
  });
}

function openDnf(id) {
  const book = state.books.find(b => b.id === id); if (!book) return;
  modal(`<h2>Stop reading?</h2><p>${esc(book.title)} will be marked DNF. Your existing progress stays in the reading history.</p><form id="dnf-form" class="form-stack">
    <div class="field"><label for="notes">Optional note</label><textarea class="input" id="notes" rows="3" placeholder="Why did you stop?"></textarea></div>
    <div class="modal-actions"><button class="btn btn-quiet" type="button" data-close>Cancel</button><button class="btn btn-danger" type="submit">Mark DNF</button></div></form>`);
  modalRoot.querySelector('#dnf-form').addEventListener('submit', async e => {
    e.preventDefault();
    await rpcAction('dnf_reading', { p_book_id: id, p_notes: e.currentTarget.notes.value.trim() || null, p_source: 'frontend' }, 'Marked DNF.');
  });
}

function confirmAction(title, text, confirmLabel, action) {
  modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="modal-actions"><button class="btn btn-quiet" data-close>Cancel</button><button class="btn btn-primary" id="confirm-action">${esc(confirmLabel)}</button></div>`);
  modalRoot.querySelector('#confirm-action').addEventListener('click', action);
}

async function rpcAction(name, args, message) {
  try {
    const { error } = await supabase.rpc(name, args);
    if (error) throw error;
    closeModal(); await loadData(true); toast(message);
  } catch (error) { toast(error.message || 'Action failed', true); }
}

function toast(message, isError = false) {
  toastNode.textContent = message;
  toastNode.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastNode._timer);
  toastNode._timer = setTimeout(() => { toastNode.className = 'toast'; }, 3200);
}

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;
  if (!session) authView();
  else {
    try { await loadData(); }
    catch (error) { app.innerHTML = `<div class="error-card"><h2>Could not load library</h2><p>${esc(error.message)}</p><button class="btn" id="error-signout">Sign out</button></div>`; app.querySelector('#error-signout')?.addEventListener('click', () => supabase.auth.signOut()); }
  }

  supabase.auth.onAuthStateChange(async (_event, sessionNow) => {
    state.session = sessionNow;
    if (!sessionNow) { state.books = []; state.recommendations = []; authView(); return; }
    try { await loadData(true); } catch (error) { toast(error.message, true); }
  });
}

init();
