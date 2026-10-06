// Queue policy shared by the background worker and its regression tests.
// Incomplete Library books continue on a slow cadence after normal retries.
export const ENRICHMENT_MAX_ATTEMPTS = 5;
export const ENRICHMENT_RETRY_BASE_MS = 6 * 60 * 60 * 1000;
export const ENRICHMENT_RETRY_MAX_MS = 7 * 24 * 60 * 60 * 1000;

export function enrichmentRetryPlan(attemptCount, metadataRetryAfter, now = Date.now()) {
  const attempts = Math.max(0, Number(attemptCount) || 0);
  const deferred = attempts >= ENRICHMENT_MAX_ATTEMPTS;
  const backoff = deferred ? ENRICHMENT_RETRY_MAX_MS : Math.min(
    ENRICHMENT_RETRY_BASE_MS * (2 ** Math.max(0, attempts - 1)),
    ENRICHMENT_RETRY_MAX_MS
  );
  const providerRetryAt = Date.parse(String(metadataRetryAfter || ''));
  const dueAt = Math.max(now + backoff, Number.isFinite(providerRetryAt) ? providerRetryAt : 0);
  return { deferred, availableAt: new Date(dueAt).toISOString() };
}

export function hasValidSchedulerCredentials({ serviceCredential, schedulerToken, suppliedSchedulerToken, requiresSchedulerToken }) {
  if (!serviceCredential) return false;
  if (!requiresSchedulerToken) return true;
  return Boolean(schedulerToken) && Boolean(suppliedSchedulerToken) && suppliedSchedulerToken === schedulerToken;
}
