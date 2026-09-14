export const GOODREADS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_GOODREADS_BATCH_SIZE = 8;
export const DEFAULT_GOODREADS_BATCH_SIZE = 6;
export const GOODREADS_RUNS_PER_DAY = 2;

export function cleanText(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function normalizeText(value) {
  return cleanText(value).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .replace(/^(the|a|an)\s+/, '');
}

export function cleanIsbn(value) {
  return String(value ?? '').replace(/[^0-9Xx]/g, '').toUpperCase();
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
  if (a.includes(b) || b.includes(a)) return 0.96;
  const aWords = new Set(a.split(' ').filter(word => word.length > 1));
  const bWords = new Set(b.split(' ').filter(word => word.length > 1));
  const overlap = [...aWords].filter(word => bWords.has(word)).length;
  return overlap / Math.max(aWords.size, bWords.size);
}

export function authorSimilarity(target, candidates = []) {
  if (!target) return 0;
  let best = 0;
  for (const candidate of candidates) {
    best = Math.max(best, textSimilarity(target, candidate));
    const wantedSurname = normalizeText(target).split(' ').at(-1);
    const candidateSurname = normalizeText(candidate).split(' ').at(-1);
    if (wantedSurname && candidateSurname && wantedSurname === candidateSurname) best = Math.max(best, 0.92);
  }
  return best;
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
  if (!candidate?.title || !candidate.authors?.length) return { matched: false, reason: 'missing_identity' };
  const expectedIsbns = [book?.isbn13, book?.isbn10].map(cleanIsbn).filter(Boolean);
  const exposedIsbns = (candidate.isbns || []).map(cleanIsbn).filter(Boolean);
  const exactIsbn = expectedIsbns.some(value => exposedIsbns.includes(value));
  const conflictingIsbn = expectedIsbns.length > 0 && exposedIsbns.length > 0 && !exactIsbn;
  const titleScore = textSimilarity(book?.title, candidate.title);
  const authorScore = authorSimilarity(book?.author, candidate.authors);
  if (exactIsbn && titleScore >= 0.72 && authorScore >= 0.72) return { matched: true, confidence: 'isbn', titleScore, authorScore };
  if (conflictingIsbn && (titleScore < 0.95 || authorScore < 0.95)) return { matched: false, reason: 'isbn_mismatch', titleScore, authorScore };
  if (titleScore >= 0.9 && authorScore >= 0.9) return { matched: true, confidence: 'title_author', titleScore, authorScore };
  return { matched: false, reason: 'insufficient_confidence', titleScore, authorScore };
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

export function retryDelayMs(failureCount) {
  if (failureCount <= 1) return 6 * 60 * 60 * 1000;
  if (failureCount === 2) return 24 * 60 * 60 * 1000;
  return 72 * 60 * 60 * 1000;
}

export function failureStateUpdate(bookId, currentFailureCount, error, status, now = Date.now()) {
  const failureCount = Number(currentFailureCount || 0) + 1;
  return {
    book_id: bookId,
    provider: 'Goodreads',
    last_attempted_at: new Date(now).toISOString(),
    next_retry_at: new Date(now + retryDelayMs(failureCount)).toISOString(),
    failure_count: failureCount,
    last_error: String(error || 'Goodreads refresh failed').slice(0, 240),
    last_http_status: status ?? null
  };
}

export function successStateUpdate(bookId, now = Date.now()) {
  return {
    book_id: bookId,
    provider: 'Goodreads',
    last_attempted_at: new Date(now).toISOString(),
    last_success_at: new Date(now).toISOString(),
    next_retry_at: new Date(now + GOODREADS_TTL_MS).toISOString(),
    failure_count: 0,
    last_error: null,
    last_http_status: 200
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
