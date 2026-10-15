const SESSION_KEY = 'rr-widget-session-v1';
const SNAPSHOT_KEY = 'rr-widget-snapshot-v1';
const DAY = 86400;

// WidgetWeb explicitly shares cookies between its app and widget WKWebViews.
// Scope to this directory, never the PWA's independent localStorage session.
export function cookieStore(doc = document, loc = location) {
  const path = new URL('.', loc.href).pathname;
  const secure = loc.protocol === 'https:' ? '; Secure' : '';
  function get(key) {
    try {
      const value = doc.cookie.split('; ').find(item => item.startsWith(`${key}=`));
      return value ? decodeURIComponent(value.slice(key.length + 1)) : null;
    } catch { return null; }
  }
  function remove(key) {
    doc.cookie = `${key}=; Path=${path}; Max-Age=0; SameSite=Strict${secure}`;
  }
  function set(key, value, maxAge, limit) {
    const encoded = encodeURIComponent(value);
    if (encoded.length > limit) { remove(key); throw new Error('Widget storage is full.'); }
    doc.cookie = `${key}=${encoded}; Path=${path}; Max-Age=${maxAge}; SameSite=Strict${secure}`;
    if (get(key) !== value) throw new Error('Allow cookies in Widget Web to connect this widget.');
  }
  return {
    getSession: () => get(SESSION_KEY),
    setSession(value) {
      const session = JSON.parse(value);
      // No email, metadata, password or provider tokens in the cookie.
      set(SESSION_KEY, JSON.stringify({
        access_token: session.access_token, refresh_token: session.refresh_token,
        expires_at: session.expires_at, token_type: 'bearer', user: { id: session.user?.id }
      }), 30 * DAY, 3600);
    },
    clearSession: () => remove(SESSION_KEY),
    getSnapshot(userId, now = Date.now()) {
      try {
        const cached = JSON.parse(get(SNAPSHOT_KEY));
        return cached?.userId === userId && cached.savedAt <= now && now - cached.savedAt < DAY * 1000 ? cached : null;
      } catch { return null; }
    },
    setSnapshot(userId, book, now = Date.now()) {
      // One bounded record; never cache API responses or a whole library.
      try { set(SNAPSHOT_KEY, JSON.stringify({ userId, book, savedAt: now }), DAY, 2400); }
      catch { remove(SNAPSHOT_KEY); }
    },
    clearSnapshot: () => remove(SNAPSHOT_KEY),
    clear() { remove(SESSION_KEY); remove(SNAPSHOT_KEY); }
  };
}
