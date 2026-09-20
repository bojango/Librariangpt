import { carouselStart, currentReadingSignature } from '../utils/carousel-memory.js';

const CURRENT_CARD_KEY = 'reading-room-current-card-v3';
const CURRENT_CARD_SIGNATURE_KEY = 'reading-room-current-card-signature-v3';
const SETTLE_DELAY_MS = 160;

export function initialiseCarousel(root, { onSettledChange } = {}) {
  const wrapper = root.querySelector('[data-carousel]');
  if (!wrapper) return;
  const track = wrapper.querySelector('.current-reading-track-v36');
  if (!track) return;
  const cards = [...track.querySelectorAll('[data-current-card]')];
  if (!cards.length) return;
  const dots = [...wrapper.querySelectorAll('[data-carousel-dot]')];
  const indicator = wrapper.querySelector('.current-reading-indicator-v36');
  const cardIds = cards.map(card => card.dataset.currentCard || '');
  let signature = currentReadingSignature(cardIds);
  let activeIndex = -1;
  let settledIndex = -1;
  let settleTimer = 0;
  let heightFrame = 0;
  let isScrolling = false;
  let heightPending = false;

  const stabiliseCardHeight = () => {
    heightFrame = 0;
    if (!track.isConnected) return;
    if (isScrolling) { heightPending = true; return; }
    heightPending = false;
    cards.forEach(card => card.style.removeProperty('height'));
    const height = Math.ceil(Math.max(...cards.map(card => card.getBoundingClientRect().height)));
    if (!height) return;
    cards.forEach(card => card.style.setProperty('height', `${height}px`, 'important'));
  };
  const scheduleStableHeight = () => {
    if (heightFrame) cancelAnimationFrame(heightFrame);
    heightFrame = requestAnimationFrame(stabiliseCardHeight);
  };
  const activate = index => {
    const safe = Math.max(0, Math.min(cards.length - 1, index));
    if (safe === activeIndex) return false;
    activeIndex = safe;
    dots.forEach((dot, position) => dot.setAttribute('aria-current', position === safe ? 'true' : 'false'));
    if (indicator && dots[safe]) indicator.style.transform = `translate3d(${dots[safe].offsetLeft}px,0,0)`;
    try {
      sessionStorage.setItem(CURRENT_CARD_KEY, cards[safe]?.dataset.currentCard || '');
      sessionStorage.setItem(CURRENT_CARD_SIGNATURE_KEY, signature);
    } catch {}
    return true;
  };
  const resolvedIndex = () => {
    const centre = track.scrollLeft + track.clientWidth / 2;
    let best = settledIndex >= 0 ? settledIndex : 0;
    let distance = Math.abs(cards[best].offsetLeft + cards[best].offsetWidth / 2 - centre);
    cards.forEach((card, index) => {
      const next = Math.abs(card.offsetLeft + card.offsetWidth / 2 - centre);
      if (next < distance - .5) { distance = next; best = index; }
    });
    return best;
  };
  const settle = source => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = 0;
    const next = resolvedIndex();
    const previous = settledIndex;
    activate(next);
    settledIndex = next;
    isScrolling = false;
    if (heightPending) scheduleStableHeight();
    if (previous >= 0 && previous !== next) onSettledChange?.({ fromIndex: previous, toIndex: next, cardCount: cards.length, source });
  };
  const queueSettle = () => {
    isScrolling = true;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => settle('scroll'), SETTLE_DELAY_MS);
  };
  track.addEventListener('scroll', queueSettle, { passive: true });
  track.addEventListener('scrollend', () => settle('scrollend'), { passive: true });
  dots.forEach((dot, index) => dot.addEventListener('click', event => {
    event.stopPropagation();
    track.scrollTo({ left: cards[index].offsetLeft, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    activate(index);
  }));
  let start = 0;
  try {
    const resolved = carouselStart(cardIds, sessionStorage.getItem(CURRENT_CARD_KEY), sessionStorage.getItem(CURRENT_CARD_SIGNATURE_KEY));
    signature = resolved.signature;
    start = resolved.index;
  } catch {}
  requestAnimationFrame(() => {
    stabiliseCardHeight();
    if (start && cards[start]) track.scrollLeft = cards[start].offsetLeft;
    activate(start);
    settledIndex = start;
  });
  document.fonts?.ready?.then(scheduleStableHeight).catch(() => {});
}
