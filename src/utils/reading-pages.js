function pages(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

// Lifecycle rows represent separate reads, including rereads. Library progress is
// a mirror of the current lifecycle, never an additional read. Timed ranges and
// test timers are deliberately not inputs: summing them would count pages twice.
export function lifetimePagesRead(records = [], books = []) {
  const seen = new Set();
  const represented = new Set();
  let total = 0;
  for (const record of records) {
    if (!record.id || seen.has(record.id) || !['Completed', 'Reading', 'Paused', 'DNF'].includes(record.status)) continue;
    seen.add(record.id);
    represented.add(record.book_id);
    const length = pages(record.total_pages);
    const progress = pages(record.current_page);
    total += record.status === 'Completed' && length ? length : length ? Math.min(progress, length) : progress;
  }
  // Legacy reads without a lifecycle retain their recorded library pages.
  for (const book of books) {
    if (represented.has(book.id) || !['Read', 'Currently Reading', 'Paused', 'DNF'].includes(book.overall_status)) continue;
    represented.add(book.id);
    const length = pages(book.total_pages);
    const progress = pages(book.current_page);
    total += book.overall_status === 'Read' && length ? length : length ? Math.min(progress, length) : progress;
  }
  return total;
}
