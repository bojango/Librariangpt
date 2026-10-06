export function routeKey(route = {}) {
  if (route.name?.startsWith('reading-session-')) return `${route.name}:${route.sessionId || ''}`;
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
    value.chapters || [],
    value.profile || null,
    value.tasteProfile || [],
    value.readingHistory || [],
    value.readingTimeSessions ?? null
  ]);
}

export function detailFingerprint(detail) {
  return JSON.stringify(detail || null);
}
