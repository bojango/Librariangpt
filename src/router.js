const ROUTES = new Set(['home', 'library', 'wishlist', 'stats']);

export function parseRoute(hash = location.hash) {
  const path = String(hash || '').replace(/^#\/?/, '');
  const [name, bookId] = path.split('/');
  if (name === 'book' && bookId) return { name: 'book', bookId: decodeURIComponent(bookId) };
  return { name: ROUTES.has(name) ? name : 'home', bookId: null };
}

export function routeHash(route) {
  return route.name === 'book' ? `#/book/${encodeURIComponent(route.bookId)}` : `#/${route.name}`;
}

export function createRouter(onChange) {
  let pendingContext = null;
  const listener = () => {
    const context = pendingContext || { source: 'hashchange' };
    pendingContext = null;
    onChange(parseRoute(), context);
  };
  window.addEventListener('hashchange', listener);
  return {
    start() {
      if (!location.hash) history.replaceState(null, '', routeHash({ name: 'home' }));
      onChange(parseRoute(), { source: 'start' });
    },
    navigate(route, { replace = false, restoreY = null } = {}) {
      const hash = routeHash(route);
      if (replace) {
        history.replaceState(null, '', hash);
        onChange(route, { source: 'navigation', restoreY });
      } else if (location.hash !== hash) {
        pendingContext = { source: 'navigation', restoreY };
        location.hash = hash;
      } else onChange(route, { source: 'same-route', restoreY });
    },
    destroy() { window.removeEventListener('hashchange', listener); }
  };
}
