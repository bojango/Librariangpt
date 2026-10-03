export async function copyNfcBookId(bookId, { clipboard = navigator.clipboard, notify } = {}) {
  try {
    await clipboard.writeText(bookId);
    notify?.('NFC book ID copied.');
  } catch {
    notify?.('Could not copy the book ID. Please try again.', true);
  }
}
