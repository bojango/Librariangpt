import { supabase } from './supabase.js';
import { tokenHash } from '../../supabase/functions/nfc-reading-session/core.js';

const columns = 'id,name,enabled,token_hint,pinned_book_id,active_book_id,last_tapped_at';
function unwrap({ data, error }) { if (error) throw error; return data; }
export async function loadBookmarks() {
  return unwrap(await supabase.from('nfc_bookmarks').select(columns).order('created_at'));
}
export async function saveBookmark({ id, name, enabled, pinnedBookId, rotate = false }) {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('Sign in to configure a bookmark.');
  const bookmarkId = id || crypto.randomUUID();
  const payload = { name: name.trim(), enabled, pinned_book_id: pinnedBookId || null };
  let token = null;
  if (!id || rotate) {
    const secret = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    token = `${bookmarkId}.${secret}`;
    payload.token_hash = await tokenHash(token);
    payload.token_hint = secret.slice(0, 6);
  }
  unwrap(await (id ? supabase.from('nfc_bookmarks').update(payload).eq('id', id)
    : supabase.from('nfc_bookmarks').insert({ ...payload, id: bookmarkId, user_id: user.id })));
  return token;
}
export async function loadTimeSession(id) {
  const session = unwrap(await supabase.from('reading_time_sessions').select('*').eq('id', id).single());
  const book = unwrap(await supabase.from('v_library').select('id,title,authors,current_page,total_pages').eq('id', session.book_id).single());
  return { ...session, book };
}
export async function loadNfcDestination() {
  return unwrap(await supabase.rpc('nfc_session_destination'));
}
export async function controlTimeSession(id, action, bookId = null) {
  return unwrap(await supabase.rpc('control_nfc_session', { p_id: id, p_action: action, p_book_id: bookId }));
}
export async function loadPendingStart(id) {
  return unwrap(await supabase.from('nfc_pending_starts').select('id,tapped_at,reason').eq('id', id).single());
}
export async function setTimeSessionKind(id, kind = 'reading') {
  return unwrap(await supabase.rpc('set_nfc_session_kind', { p_session_id: id, p_session_kind: kind }));
}
export async function finishTimeSession(id, page, skip = false) {
  return unwrap(await supabase.rpc('finish_nfc_reading_session', { p_session_id: id, p_page: page, p_skip: skip }));
}
