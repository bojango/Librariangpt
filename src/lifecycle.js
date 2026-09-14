export function routeKey(route = {}) {
  return route.name === 'book' ? `book:${route.bookId || ''}` : String(route.name || 'home');
}

export function sameRoute(left, right) {
  return routeKey(left) === routeKey(right);
}

export function snapshotFingerprint(value = {}) {
  return JSON.stringify([
    value.books || [],
    value.recommendations || [],
    value.aiRecommendations || [],
    value.upNext || [],
    value.chapters || []
  ]);
}

export function detailFingerprint(detail) {
  return JSON.stringify(detail || null);
}
