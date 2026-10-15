export function quoteChapter(value) {
  const chapter = String(value ?? '').trim();
  if (!chapter) return '';
  // Presentation only: keep the capture text unchanged in storage/editor.
  const text = chapter.replace(/^(?:chapter\s+)+/i, '');
  return text ? `Chapter ${text}` : 'Chapter';
}
