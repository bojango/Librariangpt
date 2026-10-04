# NFC reading sessions

Supabase is canonical. `reading_sessions` represents the normal full-book read;
`reading_time_sessions` represents timed periods within it. No legacy Sheet is used.
The original NFC migration is preserved; the additive extension is
`20261003055328_active_nfc_reading_sessions.sql`.

## Book choice and lifecycle

New timed sessions resolve eligible books in this order:

1. Valid `pinned_book_id` (explicit hard override).
2. Valid `active_book_id` (sticky default).
3. Most recent genuine reading evidence: a timed period lasting at least ten
   seconds on the same lifecycle, then canonical progress, then a Start/Resume
   event, then the lifecycle start timestamp.
4. The sole eligible Currently Reading book.
5. A persisted request to choose a book when no safe, unique choice exists.

Eligibility requires an owner-matched library entry marked Currently Reading and
its Reading lifecycle, neither completed, with compatible editions. Finished,
DNF, deleted, stale and inconsistent lifecycles cannot silently receive a timer.
Tied signals remain ambiguous. Library `updated_at` never resolves a book;
import/migration progress and events are excluded from genuine activity signals.

`active_book_id` is a nullable FK to books with ON DELETE SET NULL, separate from
pins. Confident starts persist the selected book across enabled bookmarks.
Canonical `reading_started` and `progress_updated` events update that shared
default, including behind pins. Disabled bookmarks are unchanged. Pins always
win for a new scan; changing the default never reassigns an existing timer.

The Choose Book and Change Book pickers prioritize Currently Reading, then Paused,
then other startable library books and support title/author search. Selecting an
unread/paused book calls the existing `start_reading` RPC logic in the transaction;
it retains that function's normal start/resume, edition, event and queue behavior.
Read/DNF books require an explicit new read through normal book controls first.

## Pending starts

`nfc_pending_starts` stores one request per owner: UUID, bookmark, original
`tapped_at`, and `no_current_book` or `needs_book_selection` reason. Repeated scans
return the same request until selection/cancellation; no timer is created yet.
The request survives PWA closure and does not depend on a URL hash.

The timer starts at **confirmed selection time**, not the original tap. This avoids
counting an arbitrarily old request as reading or predating the selected lifecycle
and page snapshot. The selection screen states this explicitly. Cancellation
removes the request without changing progress or starting a lifecycle.

## App screens and controls

The owner-scoped `nfc_session_destination()` RPC returns one atomic destination:

1. Ended pending timer -> Finish Session.
2. Running pending timer -> Active Reading Session.
3. Pending start request -> Choose Book.
4. JSON null -> Home.

Cold root/Home launch and iOS foreground visibility/focus use that same check.
Concurrent events share one request; events arriving within 750 ms coalesce.
Identity and current route are rechecked after the response to discard stale
navigation. Explicit Profile/library/book links are preserved. Session-owned
active/choose routes can reconcile an NFC stop on resume. The visible timer ticks
once a second; it stops when hidden or its page is left. No background polling.

Routes are `#/reading-session/<id>/active`, `/finish`, and `/choose` (the latter
uses the pending request ID). UUID knowledge grants no access without owner login.
A running finish link redirects to Active; an ended active link redirects to Finish.

Active shows title/author, live HH:MM:SS elapsed time, local start time and starting
page. End moves the same record to ended/pending, then Finish. Repeat app End
preserves the first ended timestamp. Later NFC scans return `awaiting_page`.
Restart requires a confirmation, keeps the record/lifecycle, resets `started_at`
to database time and `start_page` to canonical progress. Only running sessions
with a still-compatible lifecycle/edition can restart.

Change on either Active or pending Finish keeps the same timed record and both
original timestamps, relinks the selected normal lifecycle/edition, snapshots
that book's canonical page, and updates the shared active default. Finish then
prefills the corrected book's current page. Saved/skipped history cannot be changed.

Finish shows title/author, HH:MM:SS duration, local start/end times, starting page,
numeric current page, live pages read and pages/hour.
A compact Session type selector defaults to Reading; Test is available for occasional
QA so future stats can exclude those rows without deleting them. Migration
`20261003125936_nfc_session_kind.sql` classifies all pre-existing NFC timed rows
as Test and defaults all future timed sessions to Reading. Rate is omitted for durations
under a minute or invalid pages; a valid same-page session shows zero. Unknown
total pages do not prevent entry. Fractions, negative/reversed pages and pages
beyond a known total are rejected. Progress cannot go backwards relative to either
the starting snapshot or newer canonical progress.

Save calls existing `update_reading_progress(book_id,page,'nfc')` and marks the
period submitted in the same transaction. Original `ended_at` is preserved.
Repeated saves return the prior state without duplicate progress/events. Skip
resolves the period without writing progress; it remains available after a normal
lifecycle/edition has changed and page submission is consequently unsafe.

## Security and races

All three NFC tables have RLS with the existing single-owner check and `auth.uid()`
row ownership. Browsers can read safe bookmark columns and owner-scoped
session/request state, but cannot read token hashes or directly write active books,
timed sessions or pending requests. Existing bookmark creation/rotation grants
remain intact; this feature does not rotate/create the user's token.

`tap_nfc_bookmark(uuid,text)` stays SECURITY INVOKER and service-role-only.
The Edge Function validates the capability, then the database rechecks enabled
state/hash under lock. All NFC control transactions take the same per-user advisory
lock before row locks. Canonical lifecycle locks precede ordered bookmark locks,
avoiding cross-bookmark/progress lock inversion. Resolution is rechecked after
locking; a choice changed concurrently fails safely for retry. The existing unique
unresolved-period index and new unique pending-owner constraint remain in force.

`public.control_nfc_session(p_id,p_action,p_book_id)` supports `select`, `cancel`,
`change`, `restart`, `end`. Its invoker wrapper delegates to a private SECURITY
DEFINER function because browsers lack writes to protected timed/request/default
state. It checks `auth.uid()` and the canonical owner internally before lookup,
never accepts a caller-provided owner, and validates lifecycle/edition/ownership.
The reading-event trigger has similarly narrow private elevation for shared
default updates and checks the event owner against canonical owner state.
Private functions have explicit EXECUTE revokes/grants and empty search paths;
none are anonymous endpoints. Public destination/control RPCs are invokers.

## Edge response contract

POST `https://fbbpovieqfsjunmqtxvf.supabase.co/functions/v1/nfc-reading-session`

Keep the existing `X-NFC-Bookmark-Token` header and complete token. No request body,
Supabase JWT, anon/service-role key, or new secret is needed. Keep the token out of
URLs. Gateway `verify_jwt=false` is intentional capability authentication; the
server's service-role key and stored token hashes never enter frontend responses.
All replies use JSON and `Cache-Control: no-store`.

| Status | HTTP | Keys and meaning |
| --- | --- | --- |
| `started` | 200 | `status`, `session_id`, `book_id`, `book_title`, `started_at`; `ended_at`/`duration_seconds` are null |
| `ended` | 200 | Same identity/title/start plus `ended_at`, integer `duration_seconds`, `duration_hms`, `finish_url` |
| `awaiting_page` | 200 | Same ended-session keys; no new timer or changed end time |
| `duplicate_ignored` | 200 | No mutation; running duplicates include current identity/title/start; a recent resolved/cancelled request can return status only |
| `no_current_book` | 200 | `status`, `request_id`, `tapped_at`, `open_url` (HTTPS root); pending Choose Book flow |
| `needs_book_selection` | 200 | Same pending-request keys; ambiguous eligible books |
| `unauthorized` | 401 | Invalid/missing/rotated/disabled capability |
| `method_not_allowed` | 405 | Use POST |
| `temporarily_unavailable` | 503 | Retry later; do not loop rapidly |

`duration_hms` is HH:MM:SS, with hours allowed to exceed 99. The timer uses database
start/end timestamps. `duration_seconds` floors elapsed seconds; timestamps retain
subsecond precision. `finish_url` remains an HTTPS hash link for browsers/fallbacks.
Selection responses now use HTTP 200 so Shortcuts can branch normally on `status`.

## Exact iOS Shortcut changes after deployment

Keep the NFC trigger, token header and POST action exactly as configured. Extract
`status` from Get Contents of URL's JSON dictionary. Set the branches as follows:

1. **started**: Get Dictionary Value `book_title`. Show Notification with text
   `Reading session started · [book_title]`. End this branch; do not open the app.
2. **ended**: Get Dictionary Values `book_title` and `duration_hms`. Show Notification
   `Reading session ended · [book_title] · [duration_hms]`. Then use the existing
   installed-PWA root `webapp://` Open URL action. Leave its working root URL intact.
3. **awaiting_page**: Open the same PWA root to finish the existing session. Optionally
   notify `Reading session awaiting page · [book_title] · [duration_hms]`.
4. **needs_book_selection** or **no_current_book**: Show Notification
   `Choose a book for your reading session`, then open the same PWA root.
5. **duplicate_ignored**: Do nothing and stop this branch.
6. HTTP 401/503: Show the existing error notification; do not treat these as starts.

Bracketed fields above are Shortcut dictionary variables, not literal text.
No route hash is required for PWA launch: the server-persisted state chooses the
screen. HTTPS `finish_url` and `open_url` are browser fallbacks. No repository code
edits the iOS Shortcut. Test on the actual installed PWA after it receives generation
107; physical-device behavior still requires user confirmation.

## Deployment and validation

Deployed 2026-10-03 to `fbbpovieqfsjunmqtxvf`:

- Migration `20261003055328_active_nfc_reading_sessions`; stored SQL verified against
  the checked-in migration. The CLI-generated draft filename was aligned with the
  management API's actual applied timestamp; the original migration is unchanged.
- `nfc-reading-session` version 2, ACTIVE, capability auth (`verify_jwt=false`);
  deployed core verified against local source. See its `deployed.json`.
- Frontend generation 107 in index, worker, generation tests and rebuilt bundle/map.
- Full unit suite: 257 passed, zero failed. Full E2E: 143 passed, one intentional
  desktop skip for mobile-only navigation. Build/check passed (53 runtime modules).
- New and original live SQL acceptance scripts passed using synthetic owners/books
  with transaction rollback. The new script is also executed by the unit suite.
- Existing HTTP live script verified disabled/invalid tokens -> 401 against a
  disabled temporary bookmark; it was deleted. Actual timed start/controls/progress
  were verified through rollback-backed SQL, avoiding live genuine session changes.
- Security/advisor checks found no new security notices. New FK indexes have only
  expected unused-index information. Existing check-in definer/auth notices and
  unrelated book-quote FK notices remain outside this feature's scope.
- Identical pre/post fingerprints: 66 library entries, 10 full-book lifecycles,
  46 progress logs, 710 library events, 6 timed sessions, 1 existing bookmark,
  109 books, 1002 editions. The new active-book column remained null in real data.
  No Gateway status or genuine history was changed for testing; no token rotated.

Existing advisor follow-ups: [function EXECUTE review](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

GitHub Pages publication uses the existing **Deploy Reading Room to GitHub Pages**
workflow manually dispatched on `feat/nfc-reading-sessions`; never merge main.
See the completion report for the final SHA and run ID.

Rollback the frontend by restoring its previous feature-branch Pages generation.
Database controls are additive and can remain while that frontend is restored.
The original `supabase/rollback/nfc_reading_sessions.sql` predates this extension;
do not execute it against the extension without a reviewed rollback migration.
Do not delete genuine timed history or rewrite canonical progress to roll back.

## Book stickers

Separate stickers inside individual books can open their normal book page using
the same capability token without starting a timer. See [NFC book stickers](nfc-book-stickers.md)
for the API, root-launch flow, priority, and deferred iOS setup.
