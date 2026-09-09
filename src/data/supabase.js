import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../../supabase-config.js';

const pendingGets = new Map();
const nativeFetch = globalThis.fetch.bind(globalThis);

async function dedupedFetch(input, init = {}) {
  const request = new Request(input, init);
  if (request.method !== 'GET') return nativeFetch(input, init);
  const url = new URL(request.url);
  if (!url.hostname.endsWith('.supabase.co')) return nativeFetch(input, init);
  const auth = request.headers.get('authorization') || '';
  const key = `${request.method}:${request.url}:${auth}`;
  if (!pendingGets.has(key)) {
    pendingGets.set(key, nativeFetch(request).finally(() => pendingGets.delete(key)));
  }
  return (await pendingGets.get(key)).clone();
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  global: { fetch: dedupedFetch }
});

export function clearInflightRequests() {
  pendingGets.clear();
}
