// Both identity and Taste Details consume the same evidence, never editable copies.
export function signalRank(signal) {
  return ({ Strong: 30, Moderate: 18, Weak: 7 }[signal.strength] || 0)
    + ({ High: 12, Medium: 7, Low: 2 }[signal.confidence] || 0)
    + Math.min(Number(signal.evidence_count) || 0, 10);
}

export function reliableSignal(signal) {
  return ['High', 'Medium'].includes(signal.confidence) && Number(signal.evidence_count) >= 2;
}

function concise(text, limit = 150) {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  const first = value.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() || value;
  if (first.length <= limit) return first.replace(/[.]+$/, '');
  const boundary = first.lastIndexOf(' ', limit);
  return `${first.slice(0, boundary > 0 ? boundary : limit).replace(/[,;:]$/, '')}…`;
}

export function tasteIdentity(signals = [], books = []) {
  const ranked = [...signals].sort((a, b) => signalRank(b) - signalRank(a));
  const strong = ranked.filter(s => s.direction === 'Positive' && reliableSignal(s));
  const friction = ranked.filter(s => ['Negative', 'Mixed'].includes(s.direction) && reliableSignal(s));
  const emerging = ranked.filter(s => !reliableSignal(s) || !['Positive','Negative','Mixed'].includes(s.direction));
  const byId = new Map(books.map(book => [book.id, book]));
  const genreEvidence = new Map();
  for (const signal of strong) {
    for (const evidence of signal.taste_evidence || []) {
      if (evidence.relation !== 'supports' || Number(evidence.weight ?? 1) <= 0) continue;
      const book = evidence.book || byId.get(evidence.book_id);
      const genre = String(book?.primary_genre || '').trim();
      if (!genre) continue;
      if (!genreEvidence.has(genre)) genreEvidence.set(genre, new Set());
      genreEvidence.get(genre).add(evidence.book_id);
    }
  }
  const genres = [...genreEvidence].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).slice(0, 4).map(([genre]) => genre);
  const sentences = strong.slice(0, 2).map(s => concise(s.preference));
  let summary = sentences.length ? `${sentences.join('. ')}.` : 'Your reading identity will take shape as reliable taste evidence grows.';
  const negative = friction.find(s => s.direction === 'Negative');
  if (negative) summary += ` Friction: ${concise(negative.preference, 100)}.`;
  return { summary, genres, strong, friction, emerging, ranked, updated: signals.map(s => s.last_updated).filter(Boolean).sort().at(-1) || null };
}
