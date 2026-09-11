import { supabase } from '../data/supabase.js';
import { addManualCover, invoke, rpc } from '../data/library.js';
import { esc, progressText } from '../ui/format.js';
import { closeModal, showModal, toast } from '../ui/feedback.js';

const refresh = () => window.dispatchEvent(new CustomEvent('reading-room:refresh'));

export function openProgress(book) {
  const root = showModal(`<h2>Update ${esc(book.title)}</h2><p>${esc(progressText(book))}</p><form id="progress-form" class="form-stack"><div class="field"><label for="page">Current page</label><input class="input" id="page" name="page" type="number" min="0" ${book.total_pages ? `max="${book.total_pages}"` : ''} value="${book.current_page ?? ''}" required></div><div class="field"><label for="total-pages">Total pages</label><input class="input" id="total-pages" name="total" type="number" min="1" value="${book.total_pages ?? ''}"></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save progress</button></div></form>`);
  root.querySelector('#progress-form').addEventListener('submit', async event => {
    event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
    try {
      const page = Number(event.currentTarget.page.value);
      const total = event.currentTarget.total.value ? Number(event.currentTarget.total.value) : null;
      if (total && total !== Number(book.total_pages)) await rpc('set_reading_page_count', { p_book_id: book.id, p_total_pages: total, p_source: 'frontend' });
      await rpc('update_reading_progress', { p_book_id: book.id, p_page: page, p_source: 'frontend' });
      closeModal(); toast('Progress updated.'); refresh();
    } catch (error) { toast(error.message || 'Could not update progress', true); button.disabled = false; }
  });
}

export function openStart(book) {
  const root = showModal(`<h2>Start ${esc(book.title)}</h2><p>The start time is recorded automatically by the database.</p><form id="start-form" class="form-stack"><div class="field"><label for="total-pages">Total pages</label><input class="input" id="total-pages" name="total" type="number" min="1" value="${book.total_pages ?? ''}" placeholder="Optional if not known yet"></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Start reading</button></div></form>`);
  root.querySelector('#start-form').addEventListener('submit', event => submitAction(event, 'start_reading', { p_book_id: book.id, p_edition_id: book.current_edition_id || book.display_edition_id || null, p_total_pages: event.currentTarget.total.value ? Number(event.currentTarget.total.value) : null }, 'Reading started.'));
}

export function openFinish(book) {
  const root = showModal(`<h2>Finish ${esc(book.title)}</h2><p>The completion time is recorded automatically.</p><form id="finish-form" class="form-stack"><div class="field"><label for="rating">Rating / 5</label><input class="input" id="rating" name="rating" type="number" min="0" max="5" step="0.01" value="${book.user_rating_5 ?? ''}"></div><div class="field"><label for="review">Review notes</label><textarea class="input" id="review" name="review" rows="4">${esc(book.review_notes || book.user_review || '')}</textarea></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Mark finished</button></div></form>`);
  root.querySelector('#finish-form').addEventListener('submit', event => submitAction(event, 'finish_reading', { p_book_id: book.id, p_rating: event.currentTarget.rating.value ? Number(event.currentTarget.rating.value) : null, p_review: event.currentTarget.review.value.trim() || null, p_source: 'frontend' }, 'Book finished.'));
}

export function openDnf(book) {
  const root = showModal(`<h2>Stop reading?</h2><p>${esc(book.title)} will be marked DNF. Existing progress stays in reading history.</p><form id="dnf-form" class="form-stack"><div class="field"><label for="notes">Optional note</label><textarea class="input" id="notes" name="notes" rows="3"></textarea></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-danger" type="submit">Mark DNF</button></div></form>`);
  root.querySelector('#dnf-form').addEventListener('submit', event => submitAction(event, 'dnf_reading', { p_book_id: book.id, p_notes: event.currentTarget.notes.value.trim() || null, p_source: 'frontend' }, 'Marked DNF.'));
}

export function confirmPause(book) {
  const root = showModal(`<h2>Pause reading?</h2><p>This keeps your reading session and progress, but marks it paused.</p><div class="modal-actions"><button class="btn" data-close>Cancel</button><button class="btn btn-primary" data-confirm>Pause</button></div>`);
  root.querySelector('[data-confirm]').addEventListener('click', async () => { try { await rpc('pause_reading', { p_book_id: book.id, p_source: 'frontend' }); closeModal(); toast('Reading paused.'); refresh(); } catch (error) { toast(error.message || 'Could not pause reading', true); } });
}

async function submitAction(event, name, args, message) {
  event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
  try { await rpc(name, args); closeModal(); toast(message); refresh(); }
  catch (error) { toast(error.message || 'Action failed', true); button.disabled = false; }
}

export async function addToWishlist(book) {
  try { await rpc('set_library_status', { p_book_id: book.id, p_status: 'Wishlist', p_ownership: null, p_priority: null, p_source: 'frontend' }); toast('Added to wishlist.'); refresh(); }
  catch (error) { toast(error.message || 'Could not update wishlist', true); }
}

export function openReview(book) {
  const root = showModal(`<h2>${book.user_rating_5 != null ? 'Edit' : 'Add'} your rating</h2><form id="review-form" class="form-stack"><div class="quick-stars">${[1,2,3,4,5].map(value => `<button type="button" data-star="${value}">★</button>`).join('')}</div><div class="field"><label for="rating">Your rating / 5</label><input class="input rating-input" id="rating" name="rating" type="number" min="0" max="5" step="0.01" value="${book.user_rating_5 ?? ''}" required></div><div class="field"><label for="notes">Review notes</label><textarea class="input" id="notes" name="notes" rows="7">${esc(book.review_notes || book.user_review || '')}</textarea></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></form>`);
  const input = root.querySelector('#rating');
  root.querySelectorAll('[data-star]').forEach(button => button.addEventListener('click', () => { input.value = button.dataset.star; }));
  root.querySelector('#review-form').addEventListener('submit', event => submitAction(event, 'save_book_review', { p_book_id: book.id, p_rating: Number(event.currentTarget.rating.value), p_notes: event.currentTarget.notes.value.trim() || null, p_source: 'frontend' }, 'Rating saved.'));
}

export function openPageCount(book) {
  const root = showModal(`<h2>Edit page count</h2><form id="pages-form" class="form-stack"><div class="field"><label for="pages">Total pages</label><input class="input" id="pages" name="pages" type="number" min="1" value="${book.edition_page_count || book.total_pages || ''}" required></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save pages</button></div></form>`);
  root.querySelector('#pages-form').addEventListener('submit', event => submitAction(event, 'set_book_page_count', { p_book_id: book.id, p_total_pages: Number(event.currentTarget.pages.value), p_source: 'frontend' }, 'Page count updated.'));
}

export async function openCoverPicker(book) {
  const root = showModal('<h2>Edit cover</h2><p>Loading saved and available artwork…</p>');
  try {
    const result = await invoke('cover-options', { book_id: book.id });
    const candidates = result?.candidates || [];
    root.querySelector('.modal').innerHTML = `<h2>Edit cover</h2><p>${book.ownership_status === 'Owned' ? 'Exact-edition artwork is prioritised.' : 'Reference artwork is used until you own a specific edition.'}</p><div class="cover-picker-grid">${candidates.map(candidate => `<button class="cover-option ${candidate.selected ? 'selected' : ''}" data-cover-candidate="${candidate.id}" type="button"><img src="${esc(candidate.source_url)}" alt="${esc(candidate.provider)} cover" loading="lazy"><span>${esc(candidate.provider)}${candidate.exact_edition ? ' · exact ISBN' : ''}</span></button>`).join('') || '<p>No saved artwork yet.</p>'}</div><form id="custom-cover" class="form-stack"><div class="field"><label for="cover-url">Or use an image URL</label><input class="input" id="cover-url" name="url" type="url" placeholder="https://…"></div><div class="field"><label>Upload image<input class="input" name="file" type="file" accept="image/*,.heic,.heif"></label></div><div class="modal-actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save cover</button></div></form>`;
    root.querySelector('[data-close]').addEventListener('click', closeModal);
    root.querySelectorAll('[data-cover-candidate]').forEach(button => button.addEventListener('click', () => selectCover(book, button.dataset.coverCandidate, button)));
    root.querySelector('#custom-cover').addEventListener('submit', event => saveCustomCover(event, book));
  } catch (error) { closeModal(); toast(error.message || 'Could not load covers', true); }
}

async function selectCover(book, candidateId, button) {
  button.disabled = true;
  try { await invoke('select-cover', { book_id: book.id, candidate_id: candidateId, lock: true }); closeModal(); toast('Cover saved.'); refresh(); }
  catch (error) { toast(error.message || 'Could not save cover', true); button.disabled = false; }
}

async function saveCustomCover(event, book) {
  event.preventDefault(); const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
  try {
    const file = event.currentTarget.file.files?.[0];
    if (file) return uploadCover(book, file, button);
    const url = event.currentTarget.url.value.trim();
    if (!url) throw new Error('Choose an image or enter an image URL.');
    const row = await addManualCover({ book_id: book.id, edition_id: book.display_edition_id || null, provider: 'Manual URL', source_label: 'Custom URL', source_url: url, exact_edition: book.ownership_status === 'Owned' });
    await selectCover(book, row.id, button);
  } catch (error) { toast(error.message || 'Could not save cover', true); button.disabled = false; }
}

async function uploadCover(book, file, button) {
  const image = new Image(); const url = URL.createObjectURL(file);
  try {
    image.src = url; await image.decode(); const max = 2000; const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', .91); const editionId = book.display_edition_id || book.current_edition_id || book.reference_edition_id;
    if (!editionId) throw new Error('Choose an edition before uploading a cover.');
    await invoke('upload-cover-photo', { book_id: book.id, edition_id: editionId, image_base64: dataUrl.split(',')[1], mime_type: 'image/jpeg', width: canvas.width, height: canvas.height, processing: 'Manual image upload' });
    closeModal(); toast('Cover image uploaded and saved.'); refresh();
  } finally { URL.revokeObjectURL(url); button.disabled = false; }
}

export async function refreshMetadata(book, button) {
  button.disabled = true;
  try { await Promise.allSettled([invoke('content-enrichment', { book_id: book.id, force: true }), invoke('edition-options', { book_id: book.id, force: true })]); toast('Book data refreshed.'); refresh(); }
  finally { button.disabled = false; }
}
