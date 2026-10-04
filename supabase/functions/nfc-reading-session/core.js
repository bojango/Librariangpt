export async function tokenHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function secureEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== 64 || right.length !== 64) return false;
  let difference = 0;
  for (let i = 0; i < 64; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

export async function handleNfcRequest(request, dependencies) {
  const reply = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
  if (request.method !== 'POST') return reply({ status: 'method_not_allowed' }, 405);
  const token = request.headers.get('X-NFC-Bookmark-Token') || '';
  const [id, secret, extra] = token.split('.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || '') || !/^[0-9a-f]{64}$/.test(secret || '') || extra !== undefined) return reply({ status: 'unauthorized' }, 401);
  try {
    const bookmark = await dependencies.lookupBookmark(id);
    const hash = await tokenHash(token);
    const valid = secureEqual(hash, bookmark?.token_hash || '0'.repeat(64));
    if (!valid || !bookmark?.enabled) return reply({ status: 'unauthorized' }, 401);
    const base = new URL(dependencies.appBaseUrl);
    if (base.protocol !== 'https:' || base.search || base.hash || base.username || base.password) throw new Error('invalid_configuration');
    const result = await dependencies.tapBookmark(id, hash);
    if (result.status === 'unauthorized') return reply(result, 401);
    if (['ended', 'awaiting_page'].includes(result.status)) {
      const seconds = Number.isFinite(Number(result.duration_seconds)) ? Math.max(0, Math.floor(Number(result.duration_seconds))) : 0;
      result.duration_hms = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, '0')).join(':');
      result.finish_url = `${base.href.replace(/\/$/, '')}/#/reading-session/${encodeURIComponent(result.session_id)}/finish`;
    }
    if (['no_current_book', 'needs_book_selection'].includes(result.status)) result.open_url = base.href;
    // Selection is a persisted successful tap, not a dead HTTP error for Shortcuts.
    return reply(result, result.status === 'missing_reading_lifecycle' ? 409 : 200);
  } catch { return reply({ status: 'temporarily_unavailable' }, 503); }
}
