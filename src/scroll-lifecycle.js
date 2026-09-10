const ROUTES_WITH_SCROLL = new Set(['home', 'library', 'wishlist']);

export function installScrollLifecycle({ getRoute, save, cancelRestore, isSuspended = () => false, win = window, doc = document }) {
  let frame = null;

  const persist = () => {
    frame = null;
    if (isSuspended()) return;
    const route = getRoute();
    if (ROUTES_WITH_SCROLL.has(route?.name)) save(route.name, win.scrollY);
  };
  const schedule = () => {
    if (isSuspended()) return;
    if (frame === null) frame = win.requestAnimationFrame(persist);
  };
  const flush = () => {
    if (frame !== null) {
      win.cancelAnimationFrame(frame);
      frame = null;
    }
    cancelRestore();
    persist();
  };
  const visibility = () => { if (doc.visibilityState === 'hidden') flush(); };
  const pageShow = event => { if (event.persisted) cancelRestore(); };

  win.addEventListener('scroll', schedule, { passive: true });
  win.addEventListener('pagehide', flush);
  win.addEventListener('pageshow', pageShow);
  doc.addEventListener('visibilitychange', visibility);

  return () => {
    if (frame !== null) win.cancelAnimationFrame(frame);
    win.removeEventListener('scroll', schedule);
    win.removeEventListener('pagehide', flush);
    win.removeEventListener('pageshow', pageShow);
    doc.removeEventListener('visibilitychange', visibility);
  };
}
