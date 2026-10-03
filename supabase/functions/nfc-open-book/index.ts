import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { handleOpenBookRequest } from './core.js';

// Custom capability authentication; the database revalidates under lock.
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
});
Deno.serve((request: Request) => handleOpenBookRequest(request, {
  lookupBookmark: async (id: string) => {
    const { data, error } = await admin.from('nfc_bookmarks').select('token_hash,enabled').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  },
  queueBook: async (id: string, hash: string, bookId: string) => {
    const { data, error } = await admin.rpc('queue_nfc_book', { p_bookmark_id: id, p_token_hash: hash, p_book_id: bookId });
    if (error) throw error;
    return data;
  }
}));
