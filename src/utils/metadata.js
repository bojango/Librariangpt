const LEVEL = { fuzzy: 1, provider: 2, stored: 3, exact: 4, user: 5 };

export function confidenceRank(source) {
  return LEVEL[source] || 0;
}

export function mergeTrustedMetadata(existing, incoming, confidence = {}) {
  const result = { ...(existing || {}) };
  const provenance = { ...(existing?._confidence || {}) };
  for (const [field, value] of Object.entries(incoming || {})) {
    if (field === '_confidence' || value === null || value === undefined || value === '') continue;
    const next = confidence[field] || incoming._confidence?.[field] || 'provider';
    const current = provenance[field] || (result[field] ? 'stored' : 'fuzzy');
    if (!result[field] || confidenceRank(next) >= confidenceRank(current)) {
      result[field] = value;
      provenance[field] = next;
    }
  }
  result._confidence = provenance;
  return result;
}

export function chooseProviderId(storedIds = {}, candidates = []) {
  for (const candidate of candidates) {
    if (candidate.provider && storedIds[candidate.provider]) return storedIds[candidate.provider];
  }
  return null;
}

export function convertProgress(currentPage, oldTotal, newTotal, mode = 'percentage') {
  const page = Math.max(0, Number(currentPage) || 0);
  const nextTotal = Math.max(0, Number(newTotal) || 0);
  if (!nextTotal) return page;
  if (mode === 'page' || !Number(oldTotal)) return Math.min(page, nextTotal);
  return Math.min(nextTotal, Math.max(0, Math.round(page / Number(oldTotal) * nextTotal)));
}

export function selectPrimaryRating(ratings = []) {
  return ratings.find(rating => /goodreads/i.test(rating.provider || ''))
    || ratings.find(rating => rating.is_primary)
    || ratings[0]
    || null;
}

export function selectCoverCandidate(candidates = [], { owned = false } = {}) {
  return [...candidates].sort((a, b) =>
    Number(Boolean(b.selected)) - Number(Boolean(a.selected))
    || Number(Boolean(b.uploaded_by_user)) - Number(Boolean(a.uploaded_by_user))
    || (owned ? Number(Boolean(b.exact_edition)) - Number(Boolean(a.exact_edition)) : 0)
    || Number(b.confidence || b.score || 0) - Number(a.confidence || a.score || 0)
  )[0] || null;
}
