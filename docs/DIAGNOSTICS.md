# Reading Room Test Mode

Test Mode records a compact, local timeline from the real PWA so lifecycle bugs can be diagnosed from evidence. It is opt-in. When disabled, no diagnostic database is opened, no diagnostic listeners or cover/data hooks are installed, and no diagnostic network request is made.

## Architecture

`src/diagnostics/diagnostics.js` owns sessions, sequence numbers, sanitisation, buffering, limits, recovery, and upload. `storage.js` is the only IndexedDB boundary. `instrumentation.js` attaches low-frequency lifecycle/scroll/error listeners and provides the application-owned scroll wrapper. `ui.js` owns the menu, issue chooser, session history, and TEST indicator.

Events are queued briefly and written in ordered IndexedDB batches. The active session ID is the only diagnostic pointer in `localStorage`; session and event content lives in IndexedDB. An unfinished session is recovered after a document relaunch. The default limit is 5,000 stored events. Once reached, repetitive events are dropped, while issue markers, errors, lifecycle events, and programmatic/large-scroll events remain recordable.

No event is uploaded live. **End & upload** ends the local session, upserts its session record, uploads events in batches of 250, verifies the remote count, then marks the local session uploaded. `(session_id, sequence)` makes retries idempotent.

## Using Test Mode

1. Sign in and open the Reading Room menu.
2. Under **Test Mode**, choose **Turn on**. A six-character code and a small static TEST label appear.
3. Reproduce the problem. Tap **Mark issue** as soon as it occurs and choose Title wrong, Scroll jumped, Covers flashed, Whole page flickered, Missing content, Navigation issue, or Other.
4. Choose **End & upload** and record the displayed code.

**End without upload** retains the session locally. Recent local sessions can be copied or retried from the same menu. **Turn off** ends an active session and removes all diagnostic listeners/hooks, but does not delete earlier local sessions. `?test=1` enables Test Mode for Playwright/development on that document; it does not enable Test Mode for other users.

## Privacy boundary

Diagnostics never intentionally collect passwords, auth/access/refresh tokens, Authorization headers, cookies, API keys, quote or OCR text, photographed pages, reviews, reading feedback, notes, form contents, search queries, raw API bodies, or signed URL query values. Book UUIDs are allowed. Cover telemetry stores the book ID, provider hostname, priority, timing, cache counters, and dimensions—not the full cover URL. Error strings are length-limited and redact bearer credentials, JWT-shaped values, and sensitive query parameters. New event payloads must use IDs, booleans, counters, enums, and timings rather than user-authored text.

## Event taxonomy

- Session/app: `diagnostics_session_*`, `app_init_*`, `app_generation`, `document_ready_state`, `display_mode`.
- Document/PWA: `visibility_*`, `pagehide`, `pageshow`, `freeze`, `resume`, `viewport_changed`.
- Auth: `auth_get_session_*`, `auth_state_change`, `auth_bootstrap_*`; only event names and identity-equality booleans are recorded.
- Router/render: `router_start`, `route_navigation_requested`, `hashchange`, `route_render_*`, `paint_*`.
- Scroll: throttled `scroll_checkpoint`, every application-owned `programmatic_scroll_requested`, and `large_scroll_jump_detected`.
- Typography: `current_title_state` after Home paint, pageshow, and visible resume; it contains variant and geometry, never title text.
- Covers: capped individual markup/load/reuse events plus `cover_activation_summary` per activation.
- Data: snapshot/detail/refresh start, completion, failure, change/no-change, skip, and request dedupe.
- Service worker: registration/controller state and on-demand `sw_diagnostic_snapshot` with cover cache counters.
- Failures: sanitised `window_error` and `unhandled_rejection`.

## Developer API

When enabled, `window.__RR_TEST__` exposes:

```js
__RR_TEST__.isEnabled()
__RR_TEST__.session()
await __RR_TEST__.events()
__RR_TEST__.snapshot()
await __RR_TEST__.mark('scroll_jump')
__RR_TEST__.environment()
await __RR_TEST__.clearLocalDiagnostics()
```

It exposes no Supabase client, credentials, tokens, or application data. `events()` returns only the current local session in chronological sequence order.

## Supabase storage and querying

Migrations `20260910194645_add_diagnostic_test_mode.sql`, `20260910194728_restrict_diagnostic_table_grants.sql`, and `20260910194958_remove_redundant_diagnostic_index.sql` create and harden owner-scoped `diagnostic_sessions` and `diagnostic_events`. RLS permits authenticated users to select/insert/update only rows whose `user_id` is their own; anonymous access and unnecessary default privileges are revoked. No Library table is changed.

Find a reported code in the Supabase SQL editor:

```sql
select * from public.diagnostic_sessions where session_code = 'ABC234';

select e.*
from public.diagnostic_events e
join public.diagnostic_sessions s on s.id = e.session_id
where s.session_code = 'ABC234'
order by e.sequence;
```

Dashboard/administrator queries must still be handled as private personal telemetry. Intended retention is about 14 days. No scheduler was added; delete expired sessions through a reviewed administrative maintenance process, which cascades their events.

## Adding instrumentation

Use `diagnostics.event(type, compactPayload)` only at an existing application boundary. Never add polling, DOM snapshots, a MutationObserver, per-pixel scroll logging, live uploads, or raw provider responses. Keep Test Mode-off work to a boolean/null hook check. Add the event to this taxonomy and tests, and verify its payload cannot contain user-authored prose or credentials.
