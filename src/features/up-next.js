const QUEUE_STATUSES = ['Owned - Unread', 'Wishlist', 'Recommended', 'Paused'];

export function canQueueBook(book) {
  return QUEUE_STATUSES.includes(book?.overall_status);
}

export function previewQueueEdit(queue, action, args, books) {
  if (action === 'add' || action === 'add_first') {
    const existing = queue.find(item => item.id === args.book_id);
    const book = existing || books.find(item => item.id === args.book_id);
    if (!book) return queue;
    const pick = { ...book, queue_id: existing?.queue_id || book.id, source: 'Manual', locked: true, reason: 'Added manually from Library.' };
    if (action === 'add_first') {
      return [pick, ...queue.filter(item => item.id !== book.id)].map((item, index) => ({ ...item, position: index + 1 }));
    }
    if (existing) return queue.map(item => item === existing ? pick : item);
    return [...queue, { ...pick, position: (queue.at(-1)?.position || 0) + 1 }];
  }
  if (action === 'remove') return queue.filter(item => item.queue_id !== args.queue_id);
  if (action === 'lock') return queue.map(item => item.queue_id === args.queue_id ? { ...item, locked: args.locked } : item);
  if (action === 'reorder') {
    return args.queue_ids.map((id, index) => {
      const item = queue.find(row => row.queue_id === id);
      const position = index + 1;
      return item.position === position ? item : { ...item, position, locked: true, source: 'Manual' };
    });
  }
  return queue;
}
