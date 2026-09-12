import { carouselStart, currentReadingSignature } from '../utils/carousel-memory.js';

const CURRENT_CARD_KEY = 'reading-room-current-card-v3';
const CURRENT_CARD_SIGNATURE_KEY = 'reading-room-current-card-signature-v3';

export function initialiseCarousel(root) {
  const wrapper = root.querySelector('[data-carousel]');
  if (!wrapper) return;
  const track = wrapper.querySelector('.current-reading-track-v36');
  const cards = [...track.querySelectorAll('[data-current-card]')];
  const dots = [...wrapper.querySelectorAll('[data-carousel-dot]')];
  const indicator = wrapper.querySelector('.current-reading-indicator-v36');
  const cardIds = cards.map(card => card.dataset.currentCard || '');
  let signature = currentReadingSignature(cardIds);
  let frame = 0;
  const activate = index => {
    const safe = Math.max(0, Math.min(cards.length - 1, index));
    dots.forEach((dot, position) => dot.setAttribute('aria-current', position === safe ? 'true' : 'false'));
    if (indicator && dots[safe]) indicator.style.transform = `translate3d(${dots[safe].offsetLeft}px,0,0)`;
    try {
      sessionStorage.setItem(CURRENT_CARD_KEY, cards[safe]?.dataset.currentCard || '');
      sessionStorage.setItem(CURRENT_CARD_SIGNATURE_KEY, signature);
    } catch {}
  };
  const activeFromScroll = () => {
    const centre = track.scrollLeft + track.clientWidth / 2;
    let best = 0; let distance = Infinity;
    cards.forEach((card, index) => { const next = Math.abs(card.offsetLeft + card.offsetWidth / 2 - centre); if (next < distance) { distance = next; best = index; } });
    activate(best);
  };
  track.addEventListener('scroll', () => { if (frame) return; frame = requestAnimationFrame(() => { frame = 0; activeFromScroll(); }); }, { passive: true });
  dots.forEach((dot, index) => dot.addEventListener('click', event => { event.stopPropagation(); track.scrollTo({ left: cards[index].offsetLeft, behavior: 'smooth' }); activate(index); }));
  let start = 0;
  try {
    const resolved = carouselStart(cardIds, sessionStorage.getItem(CURRENT_CARD_KEY), sessionStorage.getItem(CURRENT_CARD_SIGNATURE_KEY));
    signature = resolved.signature;
    start = resolved.index;
  } catch {}
  requestAnimationFrame(() => { if (start && cards[start]) track.scrollLeft = cards[start].offsetLeft; activate(start); });
}
