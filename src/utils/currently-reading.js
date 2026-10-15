function startedAtTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

// Library snapshots arrive in title order; preserve that order for tied dates.
export function currentlyReadingBooks(books) {
  return books.filter(book => book.overall_status === 'Currently Reading').sort((a, b) => {
    const aTime = startedAtTime(a.started_at);
    const bTime = startedAtTime(b.started_at);
    return aTime === bTime ? 0 : bTime > aTime ? 1 : -1;
  });
}
