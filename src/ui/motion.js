const DOWNWARD_THRESHOLD = 60;
const UPWARD_THRESHOLD = 18;
const SWIPE_THRESHOLD = 48;
const NAV_INDEX = { home: 0, library: 1, wishlist: 2, profile: 3 };

const reducedMotion = (win = window) => win.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function installMotionController({ getRoute, goBack, win = window, doc = document }) {
  let lastY = win.scrollY;
  let direction = 0;
  let distance = 0;
  let frame = null;
  let suspended = false;
  let gesture = null;
  let settlement = null;
  let trackedMain = null;
  const routeKey = () => { const route = getRoute(); return `${route?.name}:${route?.bookId || ''}`; };

  const nav = () => doc.querySelector('.bottom-nav');
  const maxScrollY = () => Math.max(0, (doc.documentElement?.['scroll' + 'Height'] || 0) - win.innerHeight);
  const legalY = value => Math.min(maxScrollY(), Math.max(0, value));
  const resetBaseline = () => { lastY = legalY(win.scrollY); direction = 0; distance = 0; };
  const setCompact = compact => { nav()?.classList.toggle('compact', compact); };
  const expand = () => setCompact(false);
  const setNavRoute = (route = getRoute()?.name, { animate = true } = {}) => {
    const element = nav();
    if (!element || typeof NAV_INDEX[route] !== 'number') return;
    element.style.setProperty('--nav-index', String(NAV_INDEX[route]));
    element.classList.toggle('indicator-instant', !animate || reducedMotion(win));
  };
  const suspend = ({ expand: shouldExpand = false } = {}) => {
    resetGesture();
    suspended = true;
    if (frame !== null) { win.cancelAnimationFrame(frame); frame = null; }
    if (shouldExpand) expand();
    resetBaseline();
  };
  const resume = () => {
    resetBaseline();
    suspended = false;
  };
  const updateNav = () => {
    frame = null;
    if (suspended) return;
    const rawY = win.scrollY;
    const maximum = maxScrollY();
    if (rawY < 0 || rawY > maximum) {
      lastY = Math.min(maximum, Math.max(0, rawY));
      direction = 0;
      distance = 0;
      return;
    }
    const y = rawY;
    const delta = y - lastY;
    lastY = y;
    if (Math.abs(delta) < 2) return;
    const nextDirection = delta > 0 ? 1 : -1;
    if (nextDirection !== direction) { direction = nextDirection; distance = 0; }
    distance += Math.abs(delta);
    if (direction > 0 && y > 64 && distance >= DOWNWARD_THRESHOLD) { setCompact(true); distance = 0; }
    else if (direction < 0 && distance >= UPWARD_THRESHOLD) { expand(); distance = 0; }
    if (y <= 8) expand();
  };
  const onScroll = () => { if (!suspended && frame === null) frame = win.requestAnimationFrame(updateNav); };
  win.addEventListener('scroll', onScroll, { passive: true });

  const standalone = win.matchMedia('(display-mode: standalone)').matches || win.navigator.standalone === true;
  const resetGesture = () => {
    if (settlement) {
      clearTimeout(settlement.timer);
      settlement.main.removeEventListener('transitionend', settlement.end);
      settlement.main.removeEventListener('transitioncancel', settlement.cancel);
      settlement = null;
    }
    for (const main of new Set([trackedMain, doc.querySelector('#app main')])) {
      main?.classList.remove('swipe-tracking');
      main?.classList.remove('swipe-settling');
      main?.style.removeProperty('--swipe-x');
    }
    trackedMain = null;
    gesture = null;
  };
  const settleGesture = (main, x, onSettled) => {
    main.classList.remove('swipe-tracking');
    main.classList.add('swipe-settling');
    main.style.setProperty('--swipe-x', `${x}px`);
    if (reducedMotion(win)) { resetGesture(); onSettled?.(); return; }
    const route = routeKey();
    gesture = null;
    const finish = () => {
      resetGesture();
      if (routeKey() === route) onSettled?.();
    };
    const end = event => { if (event.target === main && event.propertyName === 'transform') finish(); };
    const cancel = () => resetGesture();
    settlement = { main, end, cancel, timer: setTimeout(finish, 350) };
    main.addEventListener('transitionend', end);
    main.addEventListener('transitioncancel', cancel);
  };
  const onTouchStart = event => {
    resetGesture();
    if (suspended || !standalone || getRoute()?.name !== 'book' || event.touches.length !== 1 || event.touches[0].clientX > 24 || doc.querySelector('#modal-root')?.children.length) return;
    if (event.target?.closest?.('input, textarea, button, a, [data-no-swipe], .current-reading-track-v36, .shelf, .upnext-row, .recommended-row, .filters, .awards-shelf, .edition-list')) return;
    trackedMain = doc.querySelector('#app main');
    gesture = { route: routeKey(), x: event.touches[0].clientX, y: event.touches[0].clientY, dx: 0, intent: null };
  };
  const onTouchMove = event => {
    if (!gesture) return;
    if (suspended || routeKey() !== gesture.route || event.touches.length !== 1) { resetGesture(); return; }
    const dx = Math.max(0, event.touches[0].clientX - gesture.x);
    const dy = Math.abs(event.touches[0].clientY - gesture.y);
    if (!gesture.intent && Math.max(dx, dy) > 8) gesture.intent = dx > dy * 1.35 ? 'horizontal' : 'vertical';
    if (gesture.intent !== 'horizontal') return;
    if (!event.cancelable) { resetGesture(); return; }
    event.preventDefault();
    gesture.dx = Math.min(dx, 96);
    const main = doc.querySelector('#app main');
    main?.classList.add('swipe-tracking');
    main?.style.setProperty('--swipe-x', `${gesture.dx}px`);
  };
  const onTouchEnd = () => {
    if (!gesture) return;
    const shouldNavigate = gesture.intent === 'horizontal' && gesture.dx >= SWIPE_THRESHOLD;
    const main = doc.querySelector('#app main');
    if (!main || gesture.intent !== 'horizontal') { resetGesture(); return; }
    settleGesture(main, shouldNavigate ? Math.max(110, main.getBoundingClientRect().width * .34) : 0, shouldNavigate ? goBack : null);
  };
  doc.addEventListener('touchstart', onTouchStart, { passive: true });
  doc.addEventListener('touchmove', onTouchMove, { passive: false });
  doc.addEventListener('touchend', onTouchEnd, { passive: true });
  doc.addEventListener('touchcancel', resetGesture, { passive: true });
  win.addEventListener('hashchange', resetGesture);
  win.addEventListener('pagehide', resetGesture);
  doc.addEventListener('visibilitychange', resetGesture);

  setNavRoute(getRoute()?.name, { animate: false });
  resume();
  return { suspend, resume, expand, setNavRoute, destroy() {
    resetGesture();
    if (frame !== null) win.cancelAnimationFrame(frame);
    win.removeEventListener('scroll', onScroll);
    doc.removeEventListener('touchstart', onTouchStart);
    doc.removeEventListener('touchmove', onTouchMove);
    doc.removeEventListener('touchend', onTouchEnd);
    doc.removeEventListener('touchcancel', resetGesture);
    win.removeEventListener('hashchange', resetGesture);
    win.removeEventListener('pagehide', resetGesture);
    doc.removeEventListener('visibilitychange', resetGesture);
  } };
}

export function progressSnapshot(root) {
  return new Map([...root.querySelectorAll('[data-progress-book]')].map(fill => [fill.dataset.progressBook, Number(fill.dataset.progressValue)]));
}

export function animateProgress(root, previous = new Map()) {
  if (reducedMotion()) return;
  root.querySelectorAll('[data-progress-book]').forEach(fill => {
    const before = previous.get(fill.dataset.progressBook);
    const after = Number(fill.dataset.progressValue);
    if (!Number.isFinite(before) || !Number.isFinite(after) || before === after) return;
    fill.animate([{ width: `${before}%` }, { width: `${after}%` }], { duration: 280, easing: 'cubic-bezier(.22,.61,.36,1)' });
  });
}
