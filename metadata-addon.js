import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const app = document.querySelector('#app');
const modalRoot = document.querySelector('#modal-root');
const toastNode = document.querySelector('#toast');
const bookCache = new Map();

const esc = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function toast(message, isError = false) {
  if (!toastNode) return;
  toastNode.textContent = message;
  toastNode.className = `toast show${isError ? ' error' : ''}`;
  clearTimeout(toastNode._metadataTimer);
  toastNode._metadataTimer = setTimeout(() => { toastNode.className = 'toast'; }, 4200);
}

function modal(html) {
  modalRoot.innerHTML = `<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  modalRoot.querySelectorAll('[data-meta-close]').forEach(btn => btn.addEventListener('click', closeModal));
  modalRoot.querySelector('.modal-backdrop')?.addEventListener('click', event => {
    if (event.target.classList.contains('modal-backdrop')) closeModal();
  });
}

function closeModal() { modalRoot.innerHTML = ''; }

async function functionError(error) {
  if (!error) return 'Metadata lookup failed.';
  try {
    if (error.context instanceof Response) {
      const payload = await error.context.clone().json();
      return payload?.error || error.message;
    }
  } catch {}
  return error.message || 'Metadata lookup failed.';
}

async function invokeMetadata(body) {
  const { data, error } = await supabase.functions.invoke('book-metadata', { body });
  if (error) throw new Error(await functionError(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

function resultSummary(result) {
  const m = result?.metadata || {};
  const bits = [
    m.publisher,
    m.publication_year,
    m.format,
    m.page_count ? `${m.page_count} pages` : null
  ].filter(Boolean);
  return `${m.title || 'Edition'}${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
}

async function resolveCurrentBook(detail) {
  const title = detail.querySelector('.detail-copy h1')?.textContent?.trim();
  const author = detail.querySelector('.hero-author')?.textContent?.trim();
  if (!title) return null;
  const { data, error } = await supabase.from('v_library')
    .select('id,title,authors,ownership_status,overall_status,isbn10,isbn13,display_edition_id,reference_edition_id,edition_metadata_source,metadata_match_confidence,cover_url')
    .eq('title', title);
  if (error || !data?.length) return null;
  const normalizedAuthor = String(author || '').toLowerCase();
  return data.find(row => String(row.authors || '').toLowerCase() === normalizedAuthor) || data[0];
}

function openEditionIsbn(book, owned) {
  const current = book.isbn13 || book.isbn10 || '';
  modal(`<h2>${owned ? 'Set exact owned edition' : 'Set reference edition'}</h2>
    <p>${owned
      ? `Enter the ISBN from your copy of <strong>${esc(book.title)}</strong>. This becomes the preferred physical edition and supplies its cover, publisher and page count.`
      : `Enter an ISBN if you want a particular reference edition for <strong>${esc(book.title)}</strong>.`}</p>
    <form id="meta-edition-form" class="form-stack">
      <div class="field"><label for="meta-isbn">ISBN-10 or ISBN-13</label><input class="input" id="meta-isbn" inputmode="text" autocomplete="off" value="${esc(current)}" placeholder="978…" required></div>
      <div class="modal-actions"><button class="btn btn-quiet" type="button" data-meta-close>Cancel</button><button class="btn btn-primary" type="submit">Look up edition</button></div>
    </form>`);

  modalRoot.querySelector('#meta-edition-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const isbn = event.currentTarget['meta-isbn'].value.trim();
    button.disabled = true;
    button.textContent = 'Looking up…';
    try {
      const result = await invokeMetadata({ book_id: book.id, isbn, owned, set_preferred: owned });
      closeModal();
      toast(`${resultSummary(result)} saved.`);
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
      button.textContent = 'Look up edition';
    }
  });
}

function openReferenceLookup(book) {
  modal(`<h2>Find a reference edition</h2>
    <p>LibrarianGPT will search by title and author, then attach a representative edition and cover. It will remain a reference copy, not something you own.</p>
    <div class="modal-actions"><button class="btn btn-quiet" data-meta-close>Cancel</button><button class="btn btn-primary" id="meta-reference-confirm">Find edition</button></div>`);
  modalRoot.querySelector('#meta-reference-confirm')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Searching…';
    try {
      const result = await invokeMetadata({ book_id: book.id, owned: false });
      closeModal();
      toast(`${resultSummary(result)} saved as the reference edition.`);
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
      button.textContent = 'Find edition';
    }
  });
}

function openAddByIsbn() {
  modal(`<h2>Add book by ISBN</h2>
    <p>Use an ISBN for a book you own or a specific edition you want on the wishlist. Metadata and cover art are filled automatically.</p>
    <form id="meta-add-form" class="form-stack">
      <div class="field"><label for="meta-add-isbn">ISBN-10 or ISBN-13</label><input class="input" id="meta-add-isbn" inputmode="text" autocomplete="off" placeholder="978…" required></div>
      <div class="field"><label for="meta-add-state">Add as</label><select class="input" id="meta-add-state"><option value="wishlist">Wishlist</option><option value="owned">Owned · unread</option></select></div>
      <div class="modal-actions"><button class="btn btn-quiet" type="button" data-meta-close>Cancel</button><button class="btn btn-primary" type="submit">Add book</button></div>
    </form>`);
  modalRoot.querySelector('#meta-add-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    const isbn = event.currentTarget['meta-add-isbn'].value.trim();
    const owned = event.currentTarget['meta-add-state'].value === 'owned';
    button.disabled = true;
    button.textContent = 'Looking up…';
    try {
      const result = await invokeMetadata({ isbn, owned, set_preferred: owned, overall_status: owned ? 'Owned - Unread' : 'Wishlist' });
      closeModal();
      toast(`${resultSummary(result)} added.`);
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      toast(error.message, true);
      button.disabled = false;
      button.textContent = 'Add book';
    }
  });
}

async function enhanceDetail(detail) {
  if (detail.dataset.metadataEnhanced) return;
  detail.dataset.metadataEnhanced = 'loading';
  const book = await resolveCurrentBook(detail);
  if (!book) { delete detail.dataset.metadataEnhanced; return; }
  bookCache.set(book.id, book);
  detail.dataset.metadataEnhanced = 'true';
  detail.dataset.metadataBookId = book.id;

  const actions = detail.querySelector('.detail-actions');
  if (!actions) return;
  const owned = book.ownership_status === 'Owned';
  const exact = document.createElement('button');
  exact.className = 'btn';
  exact.type = 'button';
  exact.dataset.metaEdition = book.id;
  exact.dataset.metaOwned = owned ? 'true' : 'false';
  exact.textContent = owned ? (book.isbn13 || book.isbn10 ? 'Refresh exact edition' : 'Set exact edition by ISBN') : 'Choose reference ISBN';
  actions.append(exact);

  if (!owned) {
    const auto = document.createElement('button');
    auto.className = 'btn';
    auto.type = 'button';
    auto.dataset.metaReference = book.id;
    auto.textContent = book.reference_edition_id ? 'Refresh default edition' : 'Find default edition';
    actions.append(auto);
  }

  if (book.edition_metadata_source || book.metadata_match_confidence) {
    const infoGrid = detail.querySelector('.info-grid');
    if (infoGrid) {
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = `<small>Metadata</small><strong>${esc([book.edition_metadata_source, book.metadata_match_confidence].filter(Boolean).join(' · '))}</strong>`;
      infoGrid.append(info);
    }
  }
}

function enhanceLibraryToolbar(toolbar) {
  if (toolbar.dataset.metadataEnhanced) return;
  toolbar.dataset.metadataEnhanced = 'true';
  const button = document.createElement('button');
  button.className = 'btn btn-primary';
  button.type = 'button';
  button.dataset.metaAddIsbn = 'true';
  button.textContent = 'Add by ISBN';
  toolbar.prepend(button);
}

async function enhance() {
  const detail = app?.querySelector('.detail-header');
  if (detail) enhanceDetail(detail).catch(() => { delete detail.dataset.metadataEnhanced; });
  const toolbar = app?.querySelector('.toolbar');
  if (toolbar) enhanceLibraryToolbar(toolbar);
}

document.addEventListener('click', event => {
  const editionButton = event.target.closest('[data-meta-edition]');
  if (editionButton) {
    const book = bookCache.get(editionButton.dataset.metaEdition);
    if (book) openEditionIsbn(book, editionButton.dataset.metaOwned === 'true');
    return;
  }
  const referenceButton = event.target.closest('[data-meta-reference]');
  if (referenceButton) {
    const book = bookCache.get(referenceButton.dataset.metaReference);
    if (book) openReferenceLookup(book);
    return;
  }
  if (event.target.closest('[data-meta-add-isbn]')) openAddByIsbn();
});

if (app) {
  new MutationObserver(() => enhance()).observe(app, { childList: true, subtree: true });
  enhance();
}
