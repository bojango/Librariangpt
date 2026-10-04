import { loadBookmarks, saveBookmark } from '../data/nfc.js';
import { showModal, toast } from '../ui/feedback.js';
import { escapeHtml } from '../utils/text.js';

export async function openNfcBookmarks(books) {
  try {
    const bookmarks = await loadBookmarks();
    const current = books.filter(book => book.overall_status === 'Currently Reading');
    const options = bookmark => `<option value="">Automatic current book</option>${current.map(book => `<option value="${escapeHtml(book.id)}" ${bookmark?.pinned_book_id === book.id ? 'selected' : ''}>${escapeHtml(book.title)}</option>`).join('')}${bookmark?.pinned_book_id && !current.some(book => book.id === bookmark.pinned_book_id) ? `<option value="${escapeHtml(bookmark.pinned_book_id)}" selected>Pinned book is no longer Currently Reading</option>` : ''}`;
    const form = bookmark => `<form class="form-stack nfc-bookmark-form" data-bookmark-id="${bookmark?.id || ''}"><label>Name<input class="input" name="name" maxlength="80" value="${escapeHtml(bookmark?.name || 'NFC Bookmark')}" required></label><label>Book<select class="input" name="book">${options(bookmark)}</select></label><label><input type="checkbox" name="enabled" ${bookmark?.enabled !== false ? 'checked' : ''}> Enabled</label><p>${bookmark ? `Token configured · hint ${escapeHtml(bookmark.token_hint)}` : 'Generate a token to connect your Shortcut.'}</p><div class="modal-actions"><button class="btn btn-primary" value="save" type="submit">${bookmark ? 'Save settings' : 'Create bookmark & token'}</button>${bookmark ? '<button class="btn" value="rotate" type="submit">Rotate token</button>' : ''}</div></form>`;
    const root = showModal(`<section><p class="eyebrow">Profile</p><h2>NFC Bookmark</h2><p>Automatic follows your sole Currently Reading book. Pin a book when reading several.</p>${(bookmarks.length ? bookmarks : [null]).map(form).join('')}<div data-nfc-token-slot aria-live="polite"></div><button class="btn" type="button" data-close>Close</button></section>`).querySelector('.modal');
    root.addEventListener('submit', async event => {
      const target = event.target.closest('.nfc-bookmark-form');
      if (!target) return;
      event.preventDefault();
      const buttons = target.querySelectorAll('button');
      buttons.forEach(button => { button.disabled = true; });
      try {
        const token = await saveBookmark({ id: target.dataset.bookmarkId || null, name: target.elements.name.value,
          enabled: target.elements.enabled.checked, pinnedBookId: target.elements.book.value, rotate: event.submitter?.value === 'rotate' });
        if (token) {
          // Plaintext exists only in this modal; no storage, state cache or diagnostics.
          const slot = root.querySelector('[data-nfc-token-slot]');
          slot.innerHTML = '<p>Copy this token now. Closing this window removes it. Rotation invalidates the previous token.</p><textarea class="input" readonly aria-label="New bookmark token"></textarea><button class="btn" type="button">Copy token</button>';
          slot.querySelector('textarea').value = token;
          slot.querySelector('button').onclick = async () => { try { await navigator.clipboard.writeText(token); toast('Token copied.'); } catch { toast('Select the token and copy it manually.', true); } };
          target.dataset.bookmarkId = token.split('.')[0];
          target.innerHTML = '<p>Bookmark token configured. Close this window after copying.</p>';
        } else toast('Bookmark saved.');
      } catch (error) { toast(error.message || 'Could not configure bookmark.', true); }
      finally { buttons.forEach(button => { button.disabled = false; }); }
    });
  } catch (error) { toast(error.message || 'Could not load bookmarks.', true); }
}
