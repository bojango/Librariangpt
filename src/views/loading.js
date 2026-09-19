import { chrome } from '../ui/chrome.js';
import { cover, esc } from '../ui/format.js';

export function loadingBookView(book) {
  return chrome(`<button class="back-btn" data-back><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5-7 7 7 7M8 12h9"/></svg><span>Back</span></button><section class="detail-header" data-library-detail="loading">${cover(book, '', { eager: true, high: true })}<div class="detail-copy detail-copy-v4 detail-loading-v41"><p class="eyebrow">Book</p><h1>${esc(book.title)}</h1><div class="hero-author">${esc(book.authors || '')}</div><div class="detail-loading-stack-v41"><span></span><span></span><span></span></div></div></section>`, 'library');
}
