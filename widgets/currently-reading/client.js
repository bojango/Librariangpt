import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../../supabase-config.js';
import { cookieStore } from './storage.js';

export function widgetClient(signal) {
  const store = cookieStore();
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storageKey: 'reading-room-widget-auth-v1',
      storage: {
        getItem: () => store.getSession(),
        setItem: (_key, value) => store.setSession(value),
        removeItem: () => store.clear()
      },
      persistSession: true, autoRefreshToken: false, detectSessionInUrl: false
    },
    global: { fetch: (input, init = {}) => fetch(input, {
      ...init, cache: 'no-store', referrerPolicy: 'no-referrer',
      signal: signal || AbortSignal.timeout(8000)
    }) }
  });
  return { client, store };
}

export function authFailure(error) {
  return [400, 401, 403, 422].includes(error?.status) || error?.name === 'AuthSessionMissingError';
}
