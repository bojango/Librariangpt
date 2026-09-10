export const escapeHtml = (value = '') => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

export const normaliseText = (value = '') => String(value ?? '')
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/^(the|a|an)\s+/, '');

export function titleAuthorKey(title, authors) {
  const author = Array.isArray(authors) ? authors.join(' ') : authors;
  return `${normaliseText(title)}|${normaliseText(author)}`;
}

export function currentTitleClass(title = '') {
  const words = String(title).trim().split(/\s+/).filter(Boolean);
  const characters = words.join(' ').length;
  const longestWord = words.reduce((longest, word) => Math.max(longest, word.length), 0);
  if (characters >= 44 || words.length >= 9 || longestWord >= 20) return 'current-title-tight-v37';
  if (characters >= 28 || words.length >= 6 || longestWord >= 14) return 'current-title-compact-v37';
  return '';
}

export function dedupeResults(results = []) {
  const seen = new Set();
  return results.filter(result => {
    const isbn = cleanIsbn(result.isbn13 || result.isbn10);
    const key = isbn || titleAuthorKey(result.title, result.authors);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function cleanIsbn(value) {
  return String(value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValidIsbn(value) {
  const isbn = cleanIsbn(value);
  if (/^\d{13}$/.test(isbn)) {
    const sum = isbn.slice(0, 12).split('').reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
    return (10 - (sum % 10)) % 10 === Number(isbn[12]);
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = isbn.split('').reduce((total, digit, index) => total + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0);
    return sum % 11 === 0;
  }
  return false;
}

export function exactIsbnMatch(query, candidate) {
  const expected = cleanIsbn(query);
  if (!isValidIsbn(expected)) return false;
  return [candidate?.isbn13, candidate?.isbn10, ...(candidate?.industryIdentifiers || [])]
    .map(value => cleanIsbn(typeof value === 'object' ? value.identifier : value))
    .some(value => value === expected);
}
