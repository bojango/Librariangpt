const normaliseTitle = value => String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function relatedStatus(item) {
  if (item?.overall_status === 'Read') return { icon: '✓', label: 'Read' };
  if (item?.overall_status === 'Wishlist') return { icon: '♡', label: 'Wishlist' };
  if (item?.ownership_status === 'Owned' || ['Currently Reading', 'Owned - Unread', 'Paused'].includes(item?.overall_status)) return { icon: '▣', label: 'Owned' };
  return { icon: '+', label: 'Not in your library' };
}

export function excludeSeriesFromAuthor(seriesBooks = [], authorBooks = []) {
  const ids = new Set(seriesBooks.map(item => item.book_id || item.id).filter(Boolean));
  const titles = new Set(seriesBooks.map(item => normaliseTitle(item.title)).filter(Boolean));
  return authorBooks.filter(item => {
    const id = item.book_id || item.id;
    return !ids.has(id) && !titles.has(normaliseTitle(item.title));
  });
}

export function relatedDiscoveryKey(item) {
  return String(item?.discovery_id || item?.provider_id || normaliseTitle(item?.title));
}
