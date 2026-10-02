import { esc } from '../ui/format.js';

const paths = {
  pages: '<path d="M2 3.5h4a2 2 0 0 1 2 2v7a2 2 0 0 0-2-2H2z"/><path d="M14 3.5h-4a2 2 0 0 0-2 2v7a2 2 0 0 1 2-2h4z"/>',
  ownership: '<path d="M2 13.5V5l6-3 6 3v8.5"/><path d="M4 13.5V7h8v6.5M1.5 13.5h13"/>',
  fit: '<path d="m8 1.5 1.5 4.7L14 8l-4.5 1.8L8 14.5l-1.5-4.7L2 8l4.5-1.8z"/>',
  rating: '<path d="m8 1.7 1.9 4 4.4.6-3.2 3.1.8 4.4L8 11.7l-3.9 2.1.8-4.4-3.2-3.1 4.4-.6z"/>'
};

function datum(icon, value, label) {
  return `<span class="upnext-fact" title="${esc(label)}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[icon]}</svg><span>${esc(value)}</span></span>`;
}

export function upNextOwnership(item) {
  if (['Owned', 'Borrowed'].includes(item.ownership_status)) return 'Owned';
  if (item.ownership_status === 'On Order') return 'On order';
  if (item.overall_status === 'Wishlist') return 'Wishlist';
  return 'Not owned';
}

export function upNextMetadata(item, { detailed = false } = {}) {
  const facts = [];
  const pages = Number(item.total_pages ?? item.edition_page_count);
  if (Number.isFinite(pages) && pages > 0) facts.push(datum('pages', `${Math.round(pages)} pages`, 'Length'));
  facts.push(datum('ownership', upNextOwnership(item), 'Availability'));
  const fit = Number(item.ai_score);
  if (item.ai_score != null && Number.isFinite(fit)) facts.push(datum('fit', `${fit.toFixed(1)}/10`, 'Next Fit'));
  const rating = Number(item.public_rating_5);
  if (item.public_rating_5 != null && Number.isFinite(rating) && rating > 0) {
    const provider = String(item.public_rating_provider || '').trim();
    facts.push(datum('rating', detailed && provider ? `${rating.toFixed(1)} ${provider}` : rating.toFixed(1), provider ? `${provider} rating` : 'Public rating'));
  }
  return `<div class="upnext-facts" aria-label="Book details">${facts.join('')}</div>`;
}
