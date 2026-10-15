import { widgetClient, authFailure } from './client.js';
import { loadCurrentBook } from './model.js';
import { escapeHtml as esc } from '../../src/utils/text.js';

const root = document.getElementById('widget');
const controller = new AbortController();
const { client, store } = widgetClient(controller.signal);
let settled = false;

function state(kind, title, detail, href = './setup.html') {
  root.dataset.state = kind;
  root.innerHTML = `<a class="card state-card" href="${esc(href)}"><span class="eyebrow">Currently reading</span><h1>${esc(title)}</h1><p>${esc(detail)}</p><footer><span class="brand">Reading Room</span></footer></a>`;
}

async function render(book, savedAt = null) {
  if (!book) {
    state('empty', 'Nothing currently open.', 'Your next chapter is waiting in your library.', '../../#/library');
    return;
  }
  root.dataset.state = savedAt ? 'cached' : 'book';
  const url = new URL(`../../#/book/${encodeURIComponent(book.id)}`, location.href).href;
  const freshness = savedAt ? `Saved ${new Intl.DateTimeFormat('en-GB', { hour:'2-digit', minute:'2-digit' }).format(savedAt)}` : '';
  root.innerHTML = `<a class="card" href="${esc(url)}" aria-label="Open ${esc(book.title)} in Reading Room"><div class="cover"><div class="cover-fallback"><span>${esc(book.title)}</span><small>Reading Room</small></div></div><div class="copy"><span class="eyebrow">Currently reading</span><h1>${esc(book.title)}</h1><p class="author">${esc(book.authors)}</p><div class="progress"><div class="progress-meta"><span>${book.pages} / ${book.total ?? '—'} pages</span><strong>${book.percent == null ? '—' : `${book.percent}%`}</strong></div><div class="progress-track" role="progressbar" aria-label="Reading progress" ${book.percent == null ? 'aria-valuetext="Total pages unknown"' : `aria-valuemin="0" aria-valuemax="100" aria-valuenow="${book.percent}"`}><div class="progress-fill" style="--progress:${book.percent ?? 0}%"></div></div></div></div><footer><span class="brand">Reading Room</span><span class="freshness">${esc(freshness)}</span></footer></a>`;
  if (!book.cover) return;
  const image = new Image(76, 112);
  image.alt = `Cover of ${book.title}`;
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      image.onload = image.onerror = null;
      image.removeAttribute('src');
      resolve();
    }, 2500);
    image.onload = async () => {
      try { await image.decode(); } catch {}
      clearTimeout(timer);
      if (!settled && image.naturalWidth) root.querySelector('.cover')?.replaceChildren(image);
      resolve();
    };
    image.onerror = () => { clearTimeout(timer); resolve(); };
    image.src = book.cover;
  });
}

async function refresh() {
  let userId = null;
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData.session) {
      store.clear();
      state('auth', 'Connect your library', 'Open this widget in Widget Web and tap to sign in.');
      return;
    }
    // Verify the user before using either live rows or a user-bound snapshot.
    const { data, error } = await client.auth.getUser();
    if (error) throw error;
    userId = data.user.id;
    const book = await loadCurrentBook(client, controller.signal);
    if (settled) return;
    store.setSnapshot(userId, book);
    await render(book);
  } catch (error) {
    if (settled) return;
    if (authFailure(error)) {
      store.clear();
      state('auth', 'Sign in again', 'Your widget session has ended. Open in Widget Web and reconnect.');
    } else {
      // Offline auth cannot establish identity: do not reveal a saved book.
      const cached = userId && store.getSnapshot(userId);
      if (cached) await render(cached.book, cached.savedAt);
      else state('error', 'Unable to refresh', 'Open Widget Web and reload when you are back online.');
    }
  }
}

// Resolve before WidgetWeb's 30-second maximum, even if Auth retries stall.
const timeout = setTimeout(() => {
  if (settled) return;
  settled = true;
  controller.abort();
  state('error', 'Unable to refresh', 'Open Widget Web and reload to try again.');
  window.__rrWidgetReady = true;
}, 16000);

refresh().finally(() => {
  if (settled) return;
  settled = true;
  clearTimeout(timeout);
  clearTimeout(window.__rrWidgetDeadline);
  window.__rrWidgetReady = true;
});
