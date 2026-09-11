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

export function createRouter(onChange, hooks = null) {
  let pendingContext = null;
  const listener = () => {
    const context = pendingContext || { source: 'hashchange' };
    pendingContext = null;
    const route = parseRoute();
    hooks?.event('hashchange', { route: route.name, book_id: route.bookId || null, source: context.source });
    onChange(route, context);
  };
  window.addEventListener('hashchange', listener);
  return {
    start() {
      if (!location.hash) history.replaceState(null, '', routeHash({ name: 'home' }));
      const route = parseRoute();
      hooks?.event('router_start', { route: route.name, book_id: route.bookId || null });
      onChange(route, { source: 'start' });
    },
    navigate(route, { replace = false, restoreY = null } = {}) {
      const hash = routeHash(route);
      hooks?.event('route_navigation_requested', { to: route.name, book_id: route.bookId || null, source: replace ? 'replace' : location.hash === hash ? 'same-route' : 'navigation' });
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
