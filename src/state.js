const SCROLL_KEY = 'reading-room-scroll-v2';

function readScroll() {
  try { return JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}'); }
  catch { return {}; }
}

export function createAppState() {
  let renderVersion = 0;
  const state = {
    session: null,
    books: [],
    recommendations: [],
    aiRecommendations: [],
    upNext: [],
    chapters: [],
    detail: null,
    route: { name: 'home', bookId: null },
    filters: { library: 'All', wishlist: 'Wishlist' },
    queries: { library: '', wishlist: '' },
    authMode: 'signin',
    scroll: readScroll()
  };

  return {
    value: state,
    beginRender() { renderVersion += 1; return renderVersion; },
    isCurrent(version) { return version === renderVersion; },
    update(patch) { Object.assign(state, patch); },
    setRoute(route) { state.route = route; },
    saveScroll(routeName, y) {
      state.scroll[routeName] = Math.max(0, Number(y) || 0);
      try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify(state.scroll)); } catch {}
    },
    scrollFor(routeName) { return Number(state.scroll[routeName] || 0); }
  };
}
