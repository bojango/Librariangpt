// Both identity and Taste Details consume the same evidence, never editable copies.
export function signalRank(signal) {
  return ({ Strong: 30, Moderate: 18, Weak: 7 }[signal.strength] || 0)
    + ({ High: 12, Medium: 7, Low: 2 }[signal.confidence] || 0)
    + Math.min(Number(signal.evidence_count) || 0, 10);
}

export function reliableSignal(signal) {
  return ['High', 'Medium'].includes(signal.confidence) && Number(signal.evidence_count) >= 2;
}

// Presentation taxonomy, shared by all readers. A label must still come from a
// positively supported book genre; signal prose never supplies extra genres.
export function broadGenres(value) {
  return String(value || '').split(/\s*\/\s*|\s*;\s*/).flatMap(label => {
    const key = label.trim().toLowerCase().replace(/[–—_]/g, '-');
    if (!key) return [];
    if (/^(?:(?:hard|soft|military|literary) )?(?:science fiction|sci[ -]?fi|sf)$/.test(key)) return ['Sci-Fi'];
    if (/thriller/.test(key)) return /adventure/.test(key) ? ['Adventure', 'Thriller'] : ['Thriller'];
    if (/^(?:cosy |cozy |historical |detective )?mystery$/.test(key)) return ['Mystery'];
    if (/^(?:action(?: and| &)? )?adventure(?: fiction)?$/.test(key)) return ['Adventure'];
    if (/^(?:non[ -]?fiction|travel(?: writing)?|nature(?: writing)?|biography|autobiography|memoir|history|popular science)$/.test(key)) return ['Nonfiction'];
    if (/^(?:(?:epic|high|low|urban|dark|historical) )?fantasy$/.test(key)) return ['Fantasy'];
    return [label.trim()];
  });
}

function sentences(text) {
  const value = String(text || '').trim().replace(/\s+/g, ' ');
  if (!value) return [];
  // Keep whole sentences, including conditions and qualifiers. No character cuts.
  const parts = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(value)].map(part => part.segment.trim())
    : value.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [value];
  return parts.map(part => /[.!?]["'’”]?$/.test(part) ? part : `${part}.`);
}

function personal(sentence, signal) {
  const tentative = signal.confidence !== 'High' || signal.strength === 'Weak';
  let text = sentence.replace(/^(?:strongly|generally|particularly)\s+/i, '');
  const openings = [
    [/^prefers\b/i, tentative ? 'I tend to prefer' : 'I prefer'],
    [/^enjoys\b/i, tentative ? 'I tend to enjoy' : 'I enjoy'],
    [/^(?:is )?drawn to\b/i, tentative ? 'I tend to be drawn to' : "I'm drawn to"],
    [/^(?:is )?interested in\b/i, tentative ? "I'm finding an interest in" : "I'm interested in"],
    [/^(?:strong )?aversion to\b/i, tentative ? 'I tend to avoid' : 'I avoid'],
    [/^dislikes\b/i, tentative ? 'I tend to dislike' : 'I dislike'],
    [/^does not\b/i, 'I do not'], [/^can enjoy\b/i, 'I can enjoy'],
    [/^has\b/i, 'I have'], [/^tolerant of\b/i, "I'm comfortable with"],
    [/^existing interests can\b/i, 'My existing interests can']
  ];
  const opening = openings.find(([pattern]) => pattern.test(text));
  if (opening) text = text.replace(opening[0], opening[1]);
  else if (!/^I\b|^I['’]m\b|^My\b/i.test(text)) text = `For me, ${text[0].toLowerCase()}${text.slice(1)}`;
  text = text.replace(/asks him to care about/g, 'asks me to care about');
  // Coordinated verbs still refer to the reader after changing the opening.
  text = text.replace(/\b(and|but) ((?:generally |also |strongly )?)(prefers|enjoys|dislikes)\b/g, (_, join, modifier, verb) => `${join} ${modifier}${verb.slice(0, -1)}`);
  return text;
}

function theme(signal) {
  const dimension = String(signal.dimension || '').toLowerCase();
  if (/nonfiction/.test(dimension)) return 'nonfiction';
  if (/discovery|exploration|lore|hidden|mystery|worldbuild|environmental storytelling/.test(dimension)) return 'discovery';
  if (/structure|progression|pacing|narrative usefulness/.test(dimension)) return 'progression';
  if (/science|technical|speculative|causality|competence/.test(dimension)) return 'grounding';
  if (/setting|atmosphere|subject matter|geographic/.test(dimension)) return 'setting';
  return dimension;
}

function dimensionKey(signal) {
  return String(signal.dimension || '').trim().toLowerCase();
}

export function tasteSummary(strong, friction, emerging) {
  const used = new Set();
  const conflicts = strong.filter(positive => sentences(positive.preference).length && friction.some(negative => negative.direction === 'Negative' && sentences(negative.preference).length && dimensionKey(negative) === dimensionKey(positive)));
  const positives = strong.filter(signal => !conflicts.includes(signal)).filter(signal => {
    const key = theme(signal);
    if (used.has(key) || !sentences(signal.preference).length) return false;
    used.add(key); return true;
  }).slice(0, 5).map(signal => personal(sentences(signal.preference)[0], signal));
  const unique = values => [...new Set(values.map(value => value.trim()).filter(Boolean))];
  let enjoyment = 0;
  const positiveCopy = unique(positives).map(value => value.startsWith('I enjoy ') && enjoyment++ % 2 ? value.replace(/^I enjoy /, "I'm drawn to ") : value);
  const paragraphs = [positiveCopy.slice(0, 3).join(' '), positiveCopy.slice(3).join(' ')].filter(Boolean);
  const caveats = [];
  const conflict = conflicts[0];
  if (conflict) {
    const negative = friction.find(signal => signal.direction === 'Negative' && dimensionKey(signal) === dimensionKey(conflict));
    caveats.push(`My preferences around ${dimensionKey(conflict).replace(/\s*\/\s*/g, ' and ')} are mixed.`, personal(sentences(conflict.preference)[0], conflict), personal(sentences(negative.preference)[0], negative));
  } else {
    const negative = friction.find(signal => signal.direction === 'Negative' && sentences(signal.preference).length);
    if (negative) caveats.push(...sentences(negative.preference).slice(0, 2).map(sentence => personal(sentence, negative)));
    const mixed = friction.find(signal => signal.direction === 'Mixed' && sentences(signal.preference).length);
    if (mixed) caveats.push(`My response to ${dimensionKey(mixed).replace(/\s*\/\s*/g, ' and ')} varies. ${personal(sentences(mixed.preference)[0], mixed)}`);
  }
  if (caveats.length) paragraphs.push(unique(caveats).join(' '));
  if (!paragraphs.length) {
    const tentative = emerging.find(signal => signal.direction === 'Positive' && sentences(signal.preference).length);
    paragraphs.push(tentative ? `${personal(sentences(tentative.preference)[0], tentative)} This preference is still tentative.` : "I'm still discovering what works best for my reading.");
  }
  return paragraphs;
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
      // Split explicitly recorded slash-separated labels; do not infer subgenres.
      const genres = broadGenres(book?.primary_genre);
      for (const genre of genres) {
        const key = genre.toLowerCase();
        if (!genreEvidence.has(key)) genreEvidence.set(key, { label: genre, books: new Set() });
        const bookId = evidence.book_id || book?.id;
        if (bookId) genreEvidence.get(key).books.add(bookId);
      }
    }
  }
  const genres = [...genreEvidence.values()].filter(item => item.books.size).sort((a, b) => b.books.size - a.books.size || a.label.localeCompare(b.label)).slice(0, 5).map(item => item.label);
  const summaryParagraphs = tasteSummary(strong, friction, emerging);
  return { summary: summaryParagraphs.join('\n\n'), summaryParagraphs, genres, strong, friction, emerging, ranked, updated: signals.map(s => s.last_updated).filter(Boolean).sort().at(-1) || null };
}
