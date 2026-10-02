import { supabase } from './supabase.js';
import { tokenHash } from '../../supabase/functions/nfc-reading-session/core.js';

const columns = 'id,name,enabled,token_hint,pinned_book_id,last_tapped_at';
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
  const book = unwrap(await supabase.from('v_library').select('id,title,current_page,total_pages').eq('id', session.book_id).single());
  return { ...session, book };
}
export async function loadPendingTimeSession() {
  const rows = unwrap(await supabase.from('reading_time_sessions')
    .select('id')
    .not('ended_at', 'is', null)
    .eq('progress_state', 'pending')
    .order('ended_at', { ascending: false })
    .limit(1));
  return rows?.[0] || null;
}
export async function finishTimeSession(id, page, skip = false) {
  return unwrap(await supabase.rpc('finish_nfc_reading_session', { p_session_id: id, p_page: page, p_skip: skip }));
}
