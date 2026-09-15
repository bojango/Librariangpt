export const GOODREADS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_GOODREADS_BATCH_SIZE = 8;
export const DEFAULT_GOODREADS_BATCH_SIZE = 8;
export const GOODREADS_RUNS_PER_DAY = 2;
export const ISBN_CANDIDATE_LIMIT = 3;
export const TITLE_AUTHOR_CANDIDATE_LIMIT = 5;

export function cleanText(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeText(value) {
  return cleanText(value).toLowerCase()
    .replace(/[ł]/g, 'l').replace(/[ø]/g, 'o').replace(/[ß]/g, 'ss')
    .replace(/[æ]/g, 'ae').replace(/[œ]/g, 'oe').replace(/[đð]/g, 'd').replace(/[þ]/g, 'th')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^(the|a|an)\s+/, '');
}

export const normalizeTitleStrict = normalizeText;

export function normalizeBaseTitle(value) {
  let title = cleanText(value);
  title = title.replace(/\s+by\s+.+?\s*\(\d{4}-\d{2}-\d{2}\)\s*$/i, '');
  title = title.replace(/\s*\((?:[^()]*(?:#\s*\d+(?:\.\d+)?|\bseries\b|\bbook\s+\d+\b|\bedition\b|\ba novel\b)[^()]*)\)\s*$/i, '');
  title = title.replace(/(?:\s*[,\-]\s*|\s+)a novel\s*$/i, '');
  const colon = title.indexOf(':');
  if (colon > 0) {
    const core = normalizeText(title.slice(0, colon));
    if (core.split(' ').filter(Boolean).length >= 2) title = title.slice(0, colon);
  }
  return normalizeText(title);
}

export function cleanIsbn(value) {
  return String(value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function validIsbn(value) {
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

export function goodreadsDiscoveryQueries(book) {
  return [cleanIsbn(book?.isbn13), cleanIsbn(book?.isbn10), `${cleanText(book?.title)} ${cleanText(book?.author)}`.trim()]
    .filter(Boolean);
}

export function weeklyRefreshCapacity(batchSize = DEFAULT_GOODREADS_BATCH_SIZE, runsPerDay = GOODREADS_RUNS_PER_DAY) {
  return Math.max(0, Math.floor(batchSize)) * Math.max(0, Math.floor(runsPerDay)) * 7;
}

export function textSimilarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorterWords = (a.length <= b.length ? a : b).split(' ').filter(Boolean);
  if ((a.includes(b) || b.includes(a)) && shorterWords.length >= 2) return 0.96;
  const aWords = new Set(a.split(' ').filter(word => word.length > 1));
  const bWords = new Set(b.split(' ').filter(word => word.length > 1));
  const overlap = [...aWords].filter(word => bWords.has(word)).length;
  return overlap / Math.max(aWords.size, bWords.size);
}

export function titleSimilarity(left, right) {
  const strictScore = textSimilarity(left, right);
  const leftBase = normalizeBaseTitle(left);
  const rightBase = normalizeBaseTitle(right);
  const baseScore = leftBase && rightBase ? textSimilarity(leftBase, rightBase) : 0;
  return { strictScore, baseScore, score: Math.max(strictScore, baseScore) };
}

function personIdentity(value) {
  const raw = cleanText(value);
  if (!raw || /^(?:foreword|afterword|introduction|translated|illustrated|edited|narrated)\s+by\b/i.test(raw)) return null;
  const withoutRole = raw.replace(/\s*\((?:author|editor|translator|foreword|contributor)[^)]*\)\s*$/i, '').trim();
  const commaParts = withoutRole.split(',').map(part => part.trim()).filter(Boolean);
  const display = commaParts.length === 2 ? `${commaParts[1]} ${commaParts[0]}` : withoutRole;
  const tokens = normalizeText(display).split(' ').filter(Boolean);
  if (!tokens.length) return null;
  return { normalized: tokens.join(' '), first: tokens[0], surname: tokens.at(-1), tokens };
}

export function authorSimilarity(target, candidates = []) {
  const wanted = personIdentity(target);
  const primary = personIdentity(candidates[0]);
  if (!wanted || !primary) return 0;
  if (wanted.normalized === primary.normalized) return 1;
  if (wanted.surname !== primary.surname) return 0;
  if (wanted.first === primary.first) return 0.99;
  if (wanted.first?.[0] && wanted.first[0] === primary.first?.[0]) return 0.96;
  return 0.75;
}

function jsonLdNodes(value) {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(jsonLdNodes);
  return [value, ...jsonLdNodes(value['@graph'])];
}

export function parseGoodreadsJsonLd(html) {
  const blocks = [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    try {
      for (const node of jsonLdNodes(JSON.parse(raw.trim()))) {
        if (!node?.aggregateRating) continue;
        const rating = Number(node.aggregateRating.ratingValue);
        const ratingCount = Number(node.aggregateRating.ratingCount);
        const reviewValue = node.aggregateRating.reviewCount;
        const reviewCount = reviewValue == null || reviewValue === '' ? null : Number(reviewValue);
        if (!Number.isFinite(rating) || rating < 0 || rating > 5) continue;
        if (!Number.isSafeInteger(ratingCount) || ratingCount < 1) continue;
        if (reviewCount != null && (!Number.isSafeInteger(reviewCount) || reviewCount < 0)) continue;
        const authors = (Array.isArray(node.author) ? node.author : [node.author])
          .map(author => cleanText(typeof author === 'string' ? author : author?.name)).filter(Boolean);
        const rawIsbns = [node.isbn, node.isbn10, node.isbn13].flat().map(cleanIsbn).filter(Boolean);
        return {
          title: cleanText(node.name || node.headline),
          authors,
          isbns: [...new Set(rawIsbns)],
          rating_5: rating,
          rating_count: ratingCount,
          review_count: reviewCount
        };
      }
    } catch {
      // Ignore malformed JSON-LD blocks and continue to the next structured block.
    }
  }
  return null;
}

export function validateGoodreadsCandidate(book, candidate) {
  if (!book?.title || !book?.author) return { matched: false, tier: 'UNRESOLVED', reason: 'missing_canonical_identity' };
  if (!candidate?.title || !candidate.authors?.length) return { matched: false, tier: 'UNRESOLVED', reason: 'missing_candidate_identity' };
  const expectedIsbns = [book?.isbn13, book?.isbn10].map(cleanIsbn).filter(Boolean);
  const exposedIsbns = (candidate.isbns || []).map(cleanIsbn).filter(Boolean);
  const exactIsbn = expectedIsbns.some(value => exposedIsbns.includes(value));
  const conflictingIsbn = expectedIsbns.length > 0 && exposedIsbns.length > 0 && !exactIsbn;
  const title = titleSimilarity(book?.title, candidate.title);
  const titleScore = title.score;
  const authorScore = authorSimilarity(book?.author, candidate.authors);
  const details = { titleScore, strictTitleScore: title.strictScore, baseTitleScore: title.baseScore, authorScore, exactIsbn, conflictingIsbn };
  if (exactIsbn && titleScore >= 0.72 && authorScore >= 0.9) {
    return { matched: true, tier: 'ISBN_CONFIRMED', confidence: 'isbn', ...details };
  }
  const strictExact = title.strictScore === 1;
  const baseWords = normalizeBaseTitle(book.title).split(' ').filter(Boolean).length;
  const baseTransformation = normalizeBaseTitle(book.title) !== normalizeTitleStrict(book.title)
    || normalizeBaseTitle(candidate.title) !== normalizeTitleStrict(candidate.title);
  const exceptionallyStrongTitle = titleScore >= 0.97 && (strictExact || baseWords >= 2 || baseTransformation);
  if (exceptionallyStrongTitle && authorScore >= 0.96) {
    return { matched: true, tier: 'WORK_CONFIRMED', confidence: 'work', ...details };
  }
  if (conflictingIsbn) return { matched: false, tier: 'UNRESOLVED', reason: 'isbn_mismatch_without_strong_work_identity', ...details };
  if (authorScore < 0.96) return { matched: false, tier: 'UNRESOLVED', reason: 'primary_author_mismatch', ...details };
  return { matched: false, tier: 'UNRESOLVED', reason: 'insufficient_title_confidence', ...details };
}

export function goodreadsBookIdentity(value) {
  const text = String(value || '').trim();
  const fromUrl = text.match(/^https:\/\/(?:www\.)?goodreads\.com\/(?:en\/)?book\/show\/(\d+)(?:[./?#_-]|$)/i);
  const fromId = text.match(/^(\d+)$/);
  const providerBookId = fromUrl?.[1] || fromId?.[1] || null;
  return providerBookId ? {
    providerBookId,
    sourceUrl: `https://www.goodreads.com/book/show/${providerBookId}`
  } : null;
}

function decodeGoodreadsMarkupValue(value) {
  const unescaped = String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/');
  try { return decodeURIComponent(unescaped); } catch { return unescaped; }
}

export function extractGoodreadsCandidateUrls(html, finalUrl = '') {
  const values = [];
  const add = value => {
    const decoded = decodeGoodreadsMarkupValue(value);
    const absolute = decoded.startsWith('http') ? decoded : `https://www.goodreads.com${decoded.startsWith('/') ? '' : '/'}${decoded}`;
    const identity = goodreadsBookIdentity(absolute);
    if (identity && !values.some(item => item.providerBookId === identity.providerBookId)) values.push(identity);
  };
  add(finalUrl);
  for (const match of String(html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) add(match[1]);
  const decodedHtml = decodeGoodreadsMarkupValue(html);
  for (const match of decodedHtml.matchAll(/(?:https:\/\/(?:www\.)?goodreads\.com)?\/(?:en\/)?book\/show\/\d+[^"'#?&<\\\s]*/gi)) add(match[0]);
  return values.map(identity => identity.sourceUrl);
}

export function candidateLimitForQuery(query) {
  return /^\d{9}[\dX]$|^\d{13}$/.test(cleanIsbn(query)) ? ISBN_CANDIDATE_LIMIT : TITLE_AUTHOR_CANDIDATE_LIMIT;
}

export function selectDominantExactTitleIdentity(book, candidates = []) {
  if (book?.author) return null;
  const exact = candidates.map(candidate => {
    const author = cleanText(candidate?.authors?.[0]);
    if (!author || titleSimilarity(book?.title, candidate?.title).strictScore !== 1) return null;
    return {
      author,
      authorKey: personIdentity(author)?.normalized || '',
      isbn13: validIsbn(candidate?.isbn13) ? cleanIsbn(candidate.isbn13) : null,
      isbn10: validIsbn(candidate?.isbn10) ? cleanIsbn(candidate.isbn10) : null,
      provider: cleanText(candidate?.provider),
      providerItemId: cleanText(candidate?.provider_item_id)
    };
  }).filter(candidate => candidate?.authorKey);
  if (!exact.length) return null;
  const groups = new Map();
  for (const candidate of exact) {
    const group = groups.get(candidate.authorKey) || [];
    group.push(candidate);
    groups.set(candidate.authorKey, group);
  }
  const ranked = [...groups.values()].sort((left, right) => right.length - left.length);
  const leading = ranked[0];
  const runnerUpCount = ranked[1]?.length || 0;
  if (exact.length > 1 && !(leading.length >= 2 && leading.length >= runnerUpCount * 3)) return null;
  return leading.find(candidate => candidate.isbn13 || candidate.isbn10) || leading[0];
}

export function retryDelayMs(failureCount) {
  if (failureCount <= 1) return 6 * 60 * 60 * 1000;
  if (failureCount === 2) return 24 * 60 * 60 * 1000;
  return 72 * 60 * 60 * 1000;
}

export function failureStateUpdate(bookId, currentFailureCount, error, status, now = Date.now(), diagnostic = null) {
  const failureCount = Number(currentFailureCount || 0) + 1;
  return {
    book_id: bookId,
    provider: 'Goodreads',
    last_attempted_at: new Date(now).toISOString(),
    next_retry_at: new Date(now + retryDelayMs(failureCount)).toISOString(),
    failure_count: failureCount,
    last_error: String(error || 'Goodreads refresh failed').slice(0, 240),
    last_http_status: status ?? null,
    last_resolution_tier: 'UNRESOLVED',
    last_resolution_diagnostic: diagnostic || {}
  };
}

export function successStateUpdate(bookId, now = Date.now(), tier = 'WORK_CONFIRMED') {
  return {
    book_id: bookId,
    provider: 'Goodreads',
    last_attempted_at: new Date(now).toISOString(),
    last_success_at: new Date(now).toISOString(),
    next_retry_at: new Date(now + GOODREADS_TTL_MS).toISOString(),
    failure_count: 0,
    last_error: null,
    last_http_status: 200,
    last_resolution_tier: tier,
    last_resolution_diagnostic: {}
  };
}

export function shouldRefreshGoodreads({ rating, refreshState, force = false, now = Date.now() }) {
  if (force) return true;
  const fetchedAt = rating?.fetched_at ? new Date(rating.fetched_at).getTime() : NaN;
  if (Number.isFinite(fetchedAt) && now - fetchedAt < GOODREADS_TTL_MS) return false;
  const nextRetry = refreshState?.next_retry_at ? new Date(refreshState.next_retry_at).getTime() : NaN;
  return !Number.isFinite(nextRetry) || nextRetry <= now;
}

export async function processSequentially(items, worker) {
  const results = [];
  for (const item of items) results.push(await worker(item));
  return results;
}
