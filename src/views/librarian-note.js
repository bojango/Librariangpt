import { escapeHtml } from '../utils/text.js';

export function librarianNoteMarkup(book, note) {
  if (book?.overall_status !== 'Currently Reading' || !String(note?.note_text || '').trim()) return '';
  return `<aside class="book-librarian-note" aria-label="Librarian note"><div class="book-librarian-note-label">Librarian note</div><p>${escapeHtml(note.note_text)}</p></aside>`;
}
