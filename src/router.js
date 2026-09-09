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
  const listener = () => onChange(parseRoute());
  window.addEventListener('hashchange', listener);
  return {
    start() {
      if (!location.hash) history.replaceState(null, '', routeHash({ name: 'home' }));
      listener();
    },
    navigate(route, { replace = false } = {}) {
      const hash = routeHash(route);
      if (replace) history.replaceState(null, '', hash);
      else if (location.hash !== hash) location.hash = hash;
      else onChange(route);
    },
    destroy() { window.removeEventListener('hashchange', listener); }
  };
}
