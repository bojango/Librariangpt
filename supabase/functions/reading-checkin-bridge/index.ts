// deno-lint-ignore-file no-import-prefix no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { handleBridgeRequest } from './core.js';

let admin: any = null;

function database(): any {
  if (admin) return admin;
  const url = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceRoleKey) throw new Error('bridge_not_configured');
  admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

Deno.serve((request: Request) => handleBridgeRequest(request, {
  readToken: Deno.env.get('READING_BRIDGE_READ_TOKEN') || '',
  writeToken: Deno.env.get('READING_BRIDGE_WRITE_TOKEN') || '',
  readSnapshot: async () => {
    const { data, error } = await database().rpc('reading_checkin_bridge_snapshot');
    if (error) throw error;
    return data;
  },
  saveNote: async (payload: Record<string, unknown>) => {
    const { data, error } = await database().rpc('save_reading_card_note_bridge', payload);
    if (error) throw error;
    return data;
  },
  logEvent: async (event: Record<string, unknown>) => {
    const { error } = await database().from('reading_system_events').insert(event);
    if (error) throw error;
  },
}));
