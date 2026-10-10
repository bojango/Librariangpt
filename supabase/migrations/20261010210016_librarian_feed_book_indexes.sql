-- Cover book-deletion FK lookups as well as owner/book discovery queries.
create index librarian_evidence_book_idx on private.librarian_feed_evidence(book_id);
create index librarian_receipt_book_idx on private.librarian_feed_receipts(book_id);
