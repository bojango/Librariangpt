const project = 'fbbpovieqfsjunmqtxvf';
export const api = `https://${project}.supabase.co`;
export const sessionId = '50000000-0000-0000-0000-000000000001';
const user = { id: '10000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test' };

export async function mockApp(page, { authenticated = true, inaccessible = false, state = 'pending', pendingOnLaunch = false, activeOnLaunch = false, selectionOnLaunch = false, bookOnLaunch = null, bookOverrides = {}, otherBookOverrides = {}, theme = 'reading-room', appearance = {} } = {}) {
  await page.addInitScript(({theme,appearance}) => { localStorage.setItem('reading-room-theme',theme); localStorage.setItem('reading-room-ui-preferences-v1',JSON.stringify({selectedTheme:theme,appearanceOverrides:{[theme]:appearance}})); }, {theme,appearance});
  if (authenticated) {
    const accessToken = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })).toString('base64url')}.fixture`;
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
      key: `sb-${project}-auth-token`, value: { access_token: accessToken, refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user }
    });
  }
  let pageNumber = 273;
  let ownership = 'Owned';
  let bookmark = null;
  const saves = []; const kinds = []; const bookmarkWrites = []; const statusWrites = []; const controls = []; const lifecycleQueries = [];
  let destination = pendingOnLaunch ? 'reading-session-finish' : activeOnLaunch ? 'reading-session-active' : selectionOnLaunch ? 'reading-session-choose' : null;
  let pendingBook = bookOnLaunch;
  const consumedBooks = [];
  let endedAt = activeOnLaunch ? null : '2026-10-01T10:20:34Z';
  let startedAt = activeOnLaunch ? new Date(Date.now() - 1234000).toISOString() : '2026-10-01T10:00:00Z';
  let selectedBook = 'book-1', startPage = 273;
  const book = () => ({ id: 'book-1', title: 'NFC Test Book', authors: 'Test Author', overall_status: 'Currently Reading', ownership_status: ownership, current_page: pageNumber, total_pages: 364, metadata_status: 'complete', ...bookOverrides });
  const otherBook = () => ({ id: 'book-2', title: 'Next Main Read', authors: 'Other Author', overall_status: 'Owned - Unread', ownership_status: 'Owned', current_page: 12, total_pages: 200, metadata_status: 'complete', ...otherBookOverrides });
  await page.route(`${api}/**`, async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value), headers: { 'access-control-allow-origin': '*' } });
    if (path === '/auth/v1/user') return json(user);
    if (path.endsWith('/nfc_app_destination')) {
      lifecycleQueries.push(request.method());
      if (destination) return json({ name: destination, sessionId });
      if (request.postDataJSON().p_include_book && pendingBook) {
        const bookId = pendingBook; pendingBook = null; consumedBooks.push(bookId);
        return json({ name: 'book', bookId });
      }
      return json(null);
    }
    if (path.endsWith('/nfc_pending_starts')) return json({ id: sessionId, tapped_at: startedAt, reason: 'no_current_book' });
    if (path.endsWith('/control_nfc_session')) {
      const payload = request.postDataJSON(); controls.push(payload);
      if (payload.p_action === 'cancel') { destination = null; return json({ status: 'cancelled' }); }
      if (payload.p_action === 'change' || payload.p_action === 'select') { selectedBook = payload.p_book_id; startPage = selectedBook === 'book-2' ? 12 : pageNumber; }
      if (payload.p_action === 'end') { endedAt = new Date().toISOString(); destination = 'reading-session-finish'; }
      if (payload.p_action === 'restart' || payload.p_action === 'select') { startedAt = new Date().toISOString(); startPage = selectedBook === 'book-2' ? 12 : pageNumber; endedAt = null; destination = 'reading-session-active'; }
      return json({ status: endedAt ? 'awaiting_page' : 'started', session_id: sessionId, book_id: selectedBook, started_at: startedAt, ended_at: endedAt });
    }
    if (path.endsWith('/reading_time_sessions')) {
      if (url.searchParams.get('select') === 'id') return json(pendingOnLaunch ? [{ id: sessionId }] : []);
      if (inaccessible) return json({ message: 'Row unavailable' }, 406);
      return json({ id: sessionId, book_id: selectedBook, start_page: startPage, started_at: startedAt, ended_at: endedAt, progress_state: state, session_kind: 'reading' });
    }
    if (path.endsWith('/set_nfc_session_kind')) {
      const payload = request.postDataJSON(); kinds.push(payload);
      return json({ status: 'updated', session_id: sessionId, session_kind: payload.p_session_kind });
    }
    if (path.endsWith('/finish_nfc_reading_session')) {
      const payload = request.postDataJSON(); saves.push(payload);
      if (!payload.p_skip) pageNumber = payload.p_page;
      destination = null;
      return json({ status: payload.p_skip ? 'skipped' : 'submitted', book_id: selectedBook });
    }
    if (path.endsWith('/nfc_bookmarks')) {
      if (request.method() === 'GET') return json(bookmark ? [bookmark] : []);
      const payload = request.postDataJSON(); bookmarkWrites.push(payload);
      bookmark = { ...bookmark, ...payload }; return json(null, 201);
    }
    if (path.endsWith('/set_library_status')) {
      const payload = request.postDataJSON(); statusWrites.push(payload);
      ownership = payload.p_ownership; return json(null);
    }
    if (path.endsWith('/v_library')) return json(url.searchParams.has('id') ? url.searchParams.get('id') === 'eq.book-2' ? otherBook() : book() : [book(), otherBook()]);
    if (path.endsWith('/reader_profiles')) return json(null);
    if (path.includes('/rpc/')) return json(null);
    return json([]);
  });
  return { saves, kinds, bookmarkWrites, statusWrites, controls, lifecycleQueries, consumedBooks,
    pendingBook: () => pendingBook, setBook: value => { pendingBook = value; },
    setDestination: value => { destination = value; if (value === 'reading-session-finish') endedAt = new Date().toISOString(); } };
}
