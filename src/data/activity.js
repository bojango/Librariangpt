import { supabase } from './supabase.js';

export async function loadActivity({ filter = 'all', cursor = null, limit = 20 } = {}, client = supabase) {
  let query = client.from('activity_events').select('*')
    .order('occurred_at', { ascending: false }).order('id', { ascending: false });
  if (filter === 'librarian') query = query.in('event_type', ['librarian', 'taste']);
  else if (filter === 'progress') query = query.in('event_type', ['progress', 'paused', 'dnf']);
  else if (['wishlist','started','finished','bought','quotes','rating'].includes(filter)) query = query.eq('event_type', filter);
  else if (filter !== 'all') query = query.contains('hashtags', [filter]);
  if (cursor) {
    // Cursor values come from database rows; validate before using PostgREST syntax.
    if (!/^[0-9a-f-]{36}$/i.test(cursor.id) || !Number.isFinite(Date.parse(cursor.occurred_at))) throw new Error('Invalid activity cursor');
    const stamp = new Date(cursor.occurred_at).toISOString();
    query = query.or(`occurred_at.lt.${stamp},and(occurred_at.eq.${stamp},id.lt.${cursor.id})`);
  }
  const { data, error } = await query.limit(limit + 1);
  if (error) throw error;
  const events = (data || []).slice(0, limit);
  return { events, hasMore: (data || []).length > limit, cursor: events.at(-1) || null };
}
