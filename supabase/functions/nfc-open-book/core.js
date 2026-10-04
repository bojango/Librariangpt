import { tokenHash, secureEqual } from '../nfc-reading-session/core.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleOpenBookRequest(request, dependencies) {
  const reply = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
  if (request.method !== 'POST') return reply({ status: 'method_not_allowed' }, 405);
  const token = request.headers.get('X-NFC-Bookmark-Token') || '';
  const [id, secret, extra] = token.split('.');
  if (!uuid.test(id || '') || !/^[0-9a-f]{64}$/.test(secret || '') || extra !== undefined) return reply({ status: 'unauthorized' }, 401);
  try {
    const bookmark = await dependencies.lookupBookmark(id);
    const hash = await tokenHash(token);
    const valid = secureEqual(hash, bookmark?.token_hash || '0'.repeat(64));
    if (!valid || !bookmark?.enabled) return reply({ status: 'unauthorized' }, 401);
    let body;
    try { body = await request.json(); } catch { return reply({ status: 'book_not_found' }, 400); }
    if (typeof body?.book_id !== 'string' || !uuid.test(body.book_id)) return reply({ status: 'book_not_found' }, 400);
    const result = await dependencies.queueBook(id, hash, body.book_id);
    if (result.status === 'unauthorized') return reply({ status: 'unauthorized' }, 401);
    if (result.status === 'book_not_found') return reply({ status: 'book_not_found' }, 404);
    if (result.status !== 'queued') throw new Error('Unexpected queue result');
    return reply({ status: 'queued', book_id: result.book_id, book_title: result.book_title });
  } catch { return reply({ status: 'temporarily_unavailable' }, 503); }
}
