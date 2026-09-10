import { chrome } from '../ui/chrome.js';
import { cover, esc } from '../ui/format.js';

export function loadingBookView(book) {
  return chrome(`<button class="back-btn" data-back>← Back</button><section class="detail-header" data-library-detail="loading">${cover(book, '', { eager: true, high: true })}<div class="detail-copy detail-copy-v4 detail-loading-v41"><p class="eyebrow">Book</p><h1>${esc(book.title)}</h1><div class="hero-author">${esc(book.authors || '')}</div><div class="detail-loading-stack-v41"><span></span><span></span><span></span></div></div></section>`, 'library');
}
