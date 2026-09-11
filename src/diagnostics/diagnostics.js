import { createIndexedDbStorage } from './storage.js';

const ENABLE_KEY = 'reading-room-test-mode-v1';
const ACTIVE_KEY = 'reading-room-diagnostics-active-v1';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const DEFAULT_LIMIT = 5000;
const CRITICAL = /^(issue_marker|window_error|unhandled_rejection|visibility_|pagehide|pageshow|freeze|resume|programmatic_scroll_requested|large_scroll_jump_detected|diagnostics_event_limit_reached)/;
const BLOCKED_KEY = /(password|passcode|access.?token|refresh.?token|authorization|cookie|api.?key|secret|quote.?text|ocr|review|feedback|note|search|query|response.?body|signed.?url)/i;

function storageValue(storage, key) {
  try { return storage?.getItem(key); } catch { return null; }
}

function setStorageValue(storage, key, value) {
  try { if (value == null) storage?.removeItem(key); else storage?.setItem(key, value); } catch {}
}

function safeString(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/\b(?:sbp_|sb_secret_|sk-)[A-Za-z0-9_-]+\b/gi, '[REDACTED_SECRET]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/https?:\/\/[^\s"'<>]+/gi, match => {
      try { const url = new URL(match); return `${url.origin}${url.pathname}${url.search ? '?[REDACTED]' : ''}`; }
      catch { return '[REDACTED_URL]'; }
    })
    .replace(/([?&](?:token|key|signature|sig|authorization|code)=)[^&\s]+/gi, '$1[REDACTED]')
    .slice(0, 1000);
}

export function sanitizeDiagnosticPayload(value, depth = 0) {
  if (depth > 5) return '[TRUNCATED]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return safeString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map(item => sanitizeDiagnosticPayload(item, depth + 1));
  if (typeof value !== 'object') return safeString(value);
  const clean = {};
  for (const [key, item] of Object.entries(value).slice(0, 60)) {
    if (BLOCKED_KEY.test(key)) { clean[key] = '[REDACTED]'; continue; }
    clean[key] = sanitizeDiagnosticPayload(item, depth + 1);
  }
  return clean;
}

function uuid() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-4000-8000-${Math.random().toString(16).slice(2)}`;
}

function code() {
  const bytes = new Uint8Array(6);
  globalThis.crypto?.getRandomValues?.(bytes);
  return [...bytes].map((value, index) => CODE_ALPHABET[(value || (Date.now() >> index)) % CODE_ALPHABET.length]).join('');
}

function bookUuid(value) {
  const candidate = String(value || '');
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate) ? candidate : null;
}

function environment() {
  const standalone = globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.standalone === true;
  return {
    app_generation: globalThis.document?.querySelector('meta[name="reading-room-generation"]')?.content || 'unknown',
    user_agent: safeString(globalThis.navigator?.userAgent || ''),
    platform: safeString(globalThis.navigator?.platform || ''),
    display_mode: standalone ? 'standalone' : globalThis.document ? 'browser' : 'other',
    viewport_width: globalThis.innerWidth || null,
    viewport_height: globalThis.innerHeight || null,
    device_pixel_ratio: globalThis.devicePixelRatio || null,
    orientation: globalThis.screen?.orientation?.type || null,
    connection_type: globalThis.navigator?.connection?.effectiveType || null
  };
}

export function createSupabaseDiagnosticUploader(client) {
  return {
    async upload(session, events) {
      if (!session.user_id) throw new Error('Sign in before uploading diagnostics.');
      const sessionRow = {
        id: session.id, user_id: session.user_id, session_code: session.session_code,
        started_at: session.started_at, ended_at: session.ended_at, uploaded_at: new Date().toISOString(),
        app_generation: session.app_generation, app_version: session.app_version || null,
        user_agent: session.user_agent, platform: session.platform, display_mode: session.display_mode,
        viewport_width: session.viewport_width, viewport_height: session.viewport_height,
        device_pixel_ratio: session.device_pixel_ratio, orientation: session.orientation,
        connection_type: session.connection_type, event_count: events.length,
        issue_count: session.issue_count || 0, notes: session.notes || {}
      };
      const result = await client.from('diagnostic_sessions').upsert(sessionRow, { onConflict: 'id' });
      if (result.error) throw result.error;
      for (let index = 0; index < events.length; index += 250) {
        const rows = events.slice(index, index + 250).map(event => ({
          session_id: event.session_id, user_id: session.user_id, sequence: event.sequence,
          occurred_at: event.timestamp_wall, monotonic_ms: event.timestamp_monotonic,
          type: event.type, route: event.route, book_id: event.book_id,
          visibility_state: event.visibility_state, payload: event.payload
        }));
        const batch = await client.from('diagnostic_events').upsert(rows, { onConflict: 'session_id,sequence' });
        if (batch.error) throw batch.error;
      }
      const verify = await client.from('diagnostic_events').select('id', { count: 'exact', head: true }).eq('session_id', session.id);
      if (verify.error) throw verify.error;
      if (Number.isFinite(verify.count) && verify.count !== events.length) throw new Error(`Diagnostic upload count mismatch (${verify.count}/${events.length}).`);
      return { count: events.length, uploaded_at: sessionRow.uploaded_at };
    }
  };
}

export function createDiagnostics({
  storage = createIndexedDbStorage(),
  localStorage = globalThis.localStorage,
  maxEvents = DEFAULT_LIMIT,
  now = () => new Date().toISOString(),
  monotonic = () => globalThis.performance?.now?.() ?? null,
  initialEnabled = null
} = {}) {
  let enabled = initialEnabled ?? (storageValue(localStorage, ENABLE_KEY) === '1' || new URLSearchParams(globalThis.location?.search || '').get('test') === '1');
  let active = null;
  let context = () => ({});
  let uploader = null;
  let buffer = [];
  let pending = Promise.resolve();
  let flushScheduled = false;
  let limitRecorded = false;
  const listeners = new Set();

  const notify = () => listeners.forEach(listener => listener(api.snapshot()));
  const flush = async () => {
    flushScheduled = false;
    if (!buffer.length) return pending;
    const rows = buffer.splice(0);
    const session = active ? { ...active } : null;
    pending = pending.then(async () => {
      await storage.putEvents(rows);
      if (session) await storage.putSession(session);
    });
    await pending;
  };
  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(() => { flush().catch(() => {}); });
  };
  const makeEvent = (type, payload = {}) => {
    const current = context() || {};
    active.sequence += 1;
    active.event_count += 1;
    if (type === 'issue_marker') active.issue_count += 1;
    return {
      session_id: active.id,
      sequence: active.sequence,
      timestamp_wall: now(),
      timestamp_monotonic: monotonic(),
      type: safeString(type).slice(0, 100),
      route: current.route?.name || current.route || null,
      book_id: bookUuid(current.bookId || current.route?.bookId || payload?.book_id),
      visibility_state: globalThis.document?.visibilityState || null,
      payload: sanitizeDiagnosticPayload(payload)
    };
  };

  const api = {
    isEnabled: () => enabled,
    isActive: () => Boolean(enabled && active && !active.ended_at),
    configure(options = {}) { if (options.context) context = options.context; if (options.uploader) uploader = options.uploader; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async initialize() {
      if (!enabled) return null;
      const activeId = storageValue(localStorage, ACTIVE_KEY);
      active = await storage.getSession(activeId);
      if (active?.ended_at) active = null;
      if (active) {
        api.event('diagnostics_session_resumed', { recovered: true }, { immediate: true });
        await flush();
      } else await api.startSession();
      api.exposeTestApi();
      return active;
    },
    async enable() {
      if (enabled && active) return active;
      enabled = true;
      setStorageValue(localStorage, ENABLE_KEY, '1');
      await api.startSession();
      api.exposeTestApi();
      notify();
      return active;
    },
    async disable() {
      if (active && !active.ended_at) await api.endSession();
      enabled = false;
      active = null;
      setStorageValue(localStorage, ENABLE_KEY, null);
      setStorageValue(localStorage, ACTIVE_KEY, null);
      try { delete globalThis.__RR_TEST__; } catch { globalThis.__RR_TEST__ = undefined; }
      notify();
    },
    async startSession() {
      if (!enabled) return null;
      if (active && !active.ended_at) return active;
      const env = environment();
      active = {
        id: uuid(), session_code: code(), user_id: null, started_at: now(), ended_at: null,
        uploaded_at: null, upload_status: 'local', event_count: 0, issue_count: 0, sequence: 0,
        app_version: env.app_generation, notes: {}, ...env
      };
      limitRecorded = false;
      setStorageValue(localStorage, ACTIVE_KEY, active.id);
      await storage.putSession(active);
      api.event('diagnostics_session_started', { session_code: active.session_code }, { immediate: true });
      await flush();
      notify();
      return active;
    },
    async endSession() {
      if (!active || active.ended_at) return active;
      api.event('diagnostics_session_ended', {}, { immediate: true });
      active.ended_at = now();
      setStorageValue(localStorage, ACTIVE_KEY, null);
      await flush();
      await storage.putSession(active);
      notify();
      return active;
    },
    async setUserId(userId) {
      if (!active || !userId || active.user_id === userId) return;
      active.user_id = userId;
      await storage.putSession(active);
    },
    event(type, payload = {}, options = {}) {
      if (!enabled || !active || active.ended_at) return null;
      const critical = CRITICAL.test(type);
      if (active.event_count >= maxEvents && !critical) {
        if (!limitRecorded) {
          limitRecorded = true;
          buffer.push(makeEvent('diagnostics_event_limit_reached', { limit: maxEvents }));
          scheduleFlush();
        }
        return null;
      }
      const record = makeEvent(type, payload);
      buffer.push(record);
      if (options.immediate) return flush().then(() => record);
      scheduleFlush();
      return record;
    },
    async markIssue(category) {
      const result = api.event('issue_marker', { category: safeString(category).slice(0, 60) }, { immediate: true });
      await result;
      notify();
      return result;
    },
    snapshot() { return active ? { ...active, enabled, active: !active.ended_at, pending_events: buffer.length } : { enabled, active: false }; },
    environment,
    async events() { await flush(); return active ? storage.eventsFor(active.id) : []; },
    async listSessions() { await flush(); return storage.listSessions(); },
    async upload(sessionId = active?.id) {
      await flush();
      const session = active?.id === sessionId ? active : await storage.getSession(sessionId);
      if (!session) throw new Error('Diagnostic session not found.');
      if (!session.ended_at) throw new Error('End the diagnostic session before uploading.');
      if (!uploader) throw new Error('Diagnostic upload is unavailable.');
      session.upload_status = 'uploading';
      await storage.putSession(session);
      try {
        const events = await storage.eventsFor(session.id);
        const result = await uploader.upload(session, events);
        session.uploaded_at = result.uploaded_at || now();
        session.upload_status = 'uploaded';
        await storage.putSession(session);
        if (active?.id === session.id) active = session;
        notify();
        return { ...result, session_code: session.session_code };
      } catch (error) {
        session.upload_status = 'failed';
        await storage.putSession(session);
        if (active?.id === session.id) active = session;
        notify();
        throw error;
      }
    },
    async clearLocalDiagnostics() {
      await flush();
      await storage.clear();
      active = null;
      setStorageValue(localStorage, ACTIVE_KEY, null);
      notify();
    },
    exposeTestApi() {
      if (!enabled) return;
      globalThis.__RR_TEST__ = Object.freeze({
        isEnabled: api.isEnabled,
        session: () => api.snapshot(),
        events: api.events,
        snapshot: api.snapshot,
        mark: api.markIssue,
        environment: api.environment,
        clearLocalDiagnostics: api.clearLocalDiagnostics
      });
    },
    flush
  };
  return api;
}

export const diagnostics = createDiagnostics();
