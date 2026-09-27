// iOS paints the unsafe status-bar inset from the document canvas. Keep that
// canvas in step with the header without placing a fixed layer over the page.
export function syncStatusSurface(doc = document) {
  const header = doc.querySelector('#app .topbar');
  const offscreen = !header || header.getBoundingClientRect().bottom <= 0;
  const root = doc.documentElement;
  if (root.classList.contains('header-offscreen') === offscreen) return;
  root.classList.toggle('header-offscreen', offscreen);
  if (root.dataset.theme === 'reading-room') {
    const pageColor = doc.defaultView.getComputedStyle(doc.querySelector('.layout') || doc.body).backgroundColor;
    doc.querySelector('meta[name="theme-color"]')?.setAttribute('content', offscreen ? pageColor : '#28292a');
  }
}

export function installStatusSurface(win = window, doc = document) {
  const sync = () => syncStatusSurface(doc);
  win.addEventListener('scroll', sync, { passive: true });
  win.addEventListener('resize', sync);
  win.addEventListener('pageshow', sync);
  return () => {
    win.removeEventListener('scroll', sync);
    win.removeEventListener('resize', sync);
    win.removeEventListener('pageshow', sync);
  };
}
