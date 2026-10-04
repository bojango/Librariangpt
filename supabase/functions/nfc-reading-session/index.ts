import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { handleNfcRequest } from './core.js';

// Custom capability authentication. Only the hash lookup precedes validation.
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false }
});
// Confirmed via GitHub Pages API; override for a separately deployed frontend.
const appBaseUrl = Deno.env.get('READING_ROOM_BASE_URL') || 'https://bojango.github.io/Librariangpt/';
Deno.serve((request: Request) => handleNfcRequest(request, {
  appBaseUrl,
  lookupBookmark: async (id: string) => {
    const { data, error } = await admin.from('nfc_bookmarks').select('token_hash,enabled').eq('id', id).maybeSingle();
    if (error) throw error;
    return data;
  },
  tapBookmark: async (id: string, hash: string) => {
    const { data, error } = await admin.rpc('tap_nfc_bookmark', { p_bookmark_id: id, p_token_hash: hash });
    if (error) throw error;
    return data;
  }
}));
