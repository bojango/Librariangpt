create index reading_card_notes_book_idx
  on public.reading_card_notes(book_id);

create index reading_card_notes_progress_log_idx
  on public.reading_card_notes(progress_log_id)
  where progress_log_id is not null;
