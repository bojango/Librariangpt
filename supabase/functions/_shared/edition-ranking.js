const text = value => String(value ?? '').trim();

export function cleanIsbn(value) {
  return text(value).replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValidIsbn(value) {
  const isbn = cleanIsbn(value);
  if (/^\d{13}$/.test(isbn)) {
    const sum = isbn.slice(0, 12).split('').reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    return (10 - sum % 10) % 10 === Number(isbn[12]);
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    let sum = 0;
    for (let index = 0; index < 10; index += 1) sum += (isbn[index] === 'X' ? 10 : Number(isbn[index])) * (10 - index);
    return sum % 11 === 0;
  }
  return false;
}

function canonicalIsbn13(edition) {
  const isbn13 = cleanIsbn(edition?.isbn13);
  if (isValidIsbn(isbn13) && isbn13.length === 13) return isbn13;
  const isbn10 = cleanIsbn(edition?.isbn10);
  if (!isValidIsbn(isbn10) || isbn10.length !== 10) return null;
  const stem = `978${isbn10.slice(0, 9)}`;
  const sum = stem.split('').reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${stem}${(10 - sum % 10) % 10}`;
}

export function sameEdition(left, right) {
  const leftCanonical = canonicalIsbn13(left);
  const rightCanonical = canonicalIsbn13(right);
  return Boolean(
    (leftCanonical && rightCanonical && leftCanonical === rightCanonical) ||
    (left?.isbn13 && right?.isbn13 && cleanIsbn(left.isbn13) === cleanIsbn(right.isbn13)) ||
    (left?.isbn10 && right?.isbn10 && cleanIsbn(left.isbn10) === cleanIsbn(right.isbn10)) ||
    (left?.open_library_edition_id && left.open_library_edition_id === right?.open_library_edition_id) ||
    (left?.google_books_volume_id && left.google_books_volume_id === right?.google_books_volume_id)
  );
}

export function mergeEditionCandidates(candidates) {
  const merged = [];
  for (const candidate of candidates) {
    const match = merged.find(existing => sameEdition(existing, candidate));
    if (!match) {
      merged.push({ ...candidate });
      continue;
    }
    for (const [key, value] of Object.entries(candidate)) {
      if ((match[key] == null || match[key] === '') && value != null && value !== '') match[key] = value;
    }
    match.metadata_payload = { ...(match.metadata_payload || {}), ...(candidate.metadata_payload || {}) };
  }
  return merged;
}

function formatKind(edition) {
  const value = `${text(edition?.format)} ${text(edition?.binding)}`.toLowerCase();
  if (/audio|audible|cassette|compact disc|\bcd\b/.test(value)) return 'audio';
  if (/kindle|ebook|e-book|electronic|digital/.test(value)) return 'digital';
  if (/paper|soft|hard|cloth|mass market|library binding|print/.test(value)) return 'print';
  return 'unknown';
}

function languageKind(edition) {
  const language = text(edition?.language).toLowerCase();
  if (!language) return 'unknown';
  return ['en', 'eng', 'english'].includes(language) ? 'english' : 'other';
}

export function isCredibleEdition(edition, workId = null) {
  if (!edition) return false;
  const hasIdentity = Boolean(
    (edition.isbn13 && isValidIsbn(edition.isbn13)) ||
    (edition.isbn10 && isValidIsbn(edition.isbn10)) ||
    edition.open_library_edition_id ||
    edition.google_books_volume_id
  );
  if (!hasIdentity) return false;
  return !workId || !edition.open_library_work_id || edition.open_library_work_id === workId;
}

export function referenceEditionScore(edition, workId = null) {
  if (!isCredibleEdition(edition, workId)) return Number.NEGATIVE_INFINITY;
  let score = 0;
  if (workId && edition.open_library_work_id === workId) score += 80;
  if (edition.open_library_edition_id) score += 18;
  if (edition.google_books_volume_id) score += 12;
  if (edition.isbn13 && isValidIsbn(edition.isbn13)) score += 22;
  else if (edition.isbn10 && isValidIsbn(edition.isbn10)) score += 12;
  const editionLanguage = languageKind(edition);
  if (editionLanguage === 'english') score += 24;
  else if (editionLanguage === 'unknown') score += 6;
  const kind = formatKind(edition);
  if (kind === 'print') score += 28;
  else if (kind === 'audio') score -= 45;
  else if (kind === 'digital') score -= 25;
  if (edition.cover_url) score += 18;
  if (Number(edition.page_count) > 0) score += 14;
  if (edition.publisher) score += 8;
  if (edition.publication_date) score += 7;
  else if (edition.publication_year) score += 4;
  if (edition.metadata_payload && Object.keys(edition.metadata_payload).length) score += 5;
  if (/\b(uk|gb|united kingdom|england)\b/i.test(text(edition.country))) score += 5;
  if (/gollancz|faber|canongate|picador|penguin uk|vintage uk|pan macmillan|harpercollins uk/i.test(text(edition.publisher))) score += 3;
  return score;
}

function stableEditionKey(edition) {
  return [
    text(edition.open_library_edition_id),
    cleanIsbn(edition.isbn13),
    cleanIsbn(edition.isbn10),
    text(edition.google_books_volume_id),
    text(edition.id)
  ].join('|');
}

export function chooseReferenceEdition(editions, { workId = null } = {}) {
  return [...(editions || [])]
    .filter(edition => !edition.owned && !edition.preferred_copy && !edition.exact_copy_verified && isCredibleEdition(edition, workId))
    .sort((left, right) => referenceEditionScore(right, workId) - referenceEditionScore(left, workId) || stableEditionKey(left).localeCompare(stableEditionKey(right)))[0] || null;
}

export function shouldAutoSelectReference(book, editions) {
  if (!book || book.reference_edition_id || book.current_edition_id) return false;
  if (book.ownership_status && book.ownership_status !== 'Not Owned') return false;
  return !(editions || []).some(edition => edition.owned || edition.preferred_copy || edition.exact_copy_verified);
}

export function buildEditionEnrichmentPatch(existing, candidate, fetchedAt) {
  const patch = { metadata_last_fetched_at: fetchedAt };
  const providerFields = ['open_library_edition_id', 'open_library_work_id', 'google_books_volume_id'];
  for (const field of providerFields) {
    if (!existing?.[field] && candidate?.[field] != null) patch[field] = candidate[field];
  }
  const identityFields = [
    'isbn13', 'isbn10', 'publisher', 'publication_year', 'publication_date', 'language', 'format', 'binding',
    'edition_statement', 'page_count'
  ];
  for (const field of identityFields) {
    if (!existing?.identity_locked && !existing?.[field] && candidate?.[field] != null) patch[field] = candidate[field];
  }
  if (!existing?.metadata_source && candidate?.metadata_source) patch.metadata_source = candidate.metadata_source;
  if (!existing?.metadata_match_confidence && candidate?.metadata_match_confidence) patch.metadata_match_confidence = candidate.metadata_match_confidence;
  if (candidate?.metadata_payload && Object.keys(candidate.metadata_payload).length) {
    patch.metadata_payload = { ...(existing?.metadata_payload || {}), ...candidate.metadata_payload };
  }
  if (!existing?.cover_locked && !existing?.cover_uploaded_by_user && !existing?.cover_url && candidate?.cover_url) {
    patch.cover_url = candidate.cover_url;
    patch.cover_source = candidate.cover_source || 'Metadata provider';
    patch.cover_verified = true;
  }
  return patch;
}
