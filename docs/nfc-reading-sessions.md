# NFC bookmark reading sessions

`reading_sessions` still represents the full-book lifecycle. NFC periods live in
`reading_time_sessions`; no reading status is changed by a tap. Saving a finishing
page calls the existing `update_reading_progress(book_id,page,'nfc')` RPC in the
same transaction as marking the timed session submitted. Its source whitelist
and `progress_logs` check now accept `nfc`; all previous sources retain their behaviour.

## Tables and security

- `nfc_bookmarks`: owner, name, SHA-256 token hash, safe six-character hint,
  enabled flag, optional pinned book, last accepted tap, timestamps.
- `reading_time_sessions`: owner/bookmark, book/edition/full-book lifecycle IDs,
  exact start/end timestamps and pages, pending/submitted/skipped progress state,
  submission timestamp. Duration is derived from timestamps, never stored.

Both tables have owner-only RLS using the existing single-owner check plus user
identity. Browser grants exclude the hash; timed rows cannot be edited directly.
An authenticated RPC delegates to a narrowly scoped private function for atomic
page submission with an explicit owner check. The tap RPC is service-role-only.
Bookmark/user foreign keys, a partial unique index for **one unresolved period per
user**, and transaction locks protect concurrent taps across bookmarks.

The browser generates a 256-bit random secret with Web Crypto, hashes the complete
`bookmark-uuid.secret` token and sends only the hash to the database. The raw token
appears once in the current modal and Copy action. It never enters application
state, local storage, database rows, logs or documentation. Rotation immediately
invalidates the old token. Closing the modal removes the raw token; rotate again
if it was lost. The small hint is not a usable token.

## Endpoint

POST `https://fbbpovieqfsjunmqtxvf.supabase.co/functions/v1/nfc-reading-session`

Header: `X-NFC-Bookmark-Token: <the complete one-time token>`

No request body, Supabase user JWT, API key, or service-role key is needed. Never
put the token in the URL. `verify_jwt=false` is deliberate: this external endpoint
validates its own capability, compares SHA-256 digests with a fixed-length
comparison and checks enabled state before mutation. The database rechecks the
hash/enabled/owner under lock to close rotation/disable races. Privileged keys stay
in Supabase's server environment. The handler never logs request headers or tokens.

Responses are JSON with `Cache-Control: no-store`:

| status | HTTP | Meaning |
| --- | --- | --- |
| `started` | 200 | `session_id`, `book_id`, `book_title`, `started_at` |
| `ended` | 200 | Same session; `ended_at`, precise `duration_seconds`, `finish_url` |
| `awaiting_page` | 200 | Ended session still needs page; same duration and finish URL |
| `duplicate_ignored` | 200 | Rapid repeat (under 10 seconds); no change |
| `no_current_book` | 409 | No Currently Reading book, or pinned book is not current |
| `needs_book_selection` | 409 | Multiple current books; set a pin in Profile |
| `missing_reading_lifecycle` | 409 | Current book lacks its active full-book session |
| `unauthorized` | 401 | Missing/invalid/rotated/disabled token |
| `method_not_allowed` | 405 | Use POST |
| `temporarily_unavailable` | 503 | Retry later; do not retry in a rapid loop |

An ended pending session always returns `awaiting_page`, including a rapid third
tap. Only Save or explicit Skip releases it. Duplicate attempts do not extend the
debounce window. Database timestamps are captured when the authenticated tap
transaction runs, including subsecond precision; HTTP transit time is not measured.

## Finish and token setup

The hash router accepts `#/reading-session/<id>/finish`. The owner must sign in
in the browser/PWA; knowing the UUID grants no access. The page shows title,
duration, numeric autofocus Current page (prefilled from current canonical
progress), Save and a secondary Skip. Save writes canonical progress/events and
the timed end page atomically, then returns to the book. `ended_at` never changes
on page submission. Repeat saves produce no extra logs. A changed lifecycle or
edition is refused to avoid attaching old progress to a new read; Skip clears the
pending entry without writing progress. Book deletion follows existing cascade
behaviour; historical edition/lifecycle references become null if those are deleted.

In **Profile → NFC Bookmark → Configure bookmark**, create/name the bookmark and
copy its new token. Leave Book on Automatic for a sole current book, or pin one
when reading several. Reopen this section to rename, rotate or disable/re-enable.
Disabled bookmarks keep their history. Re-enable to end a still-running period.

## Tomorrow's iOS Shortcut

1. Open the deployed Reading Room, sign in and generate/copy the token in Profile.
2. Create the NFC personal automation separately and scan the physical bookmark.
3. Use Get Contents of URL with the endpoint above, method POST, and the dedicated
   header containing the complete token. Do not put any Supabase key in Shortcuts.
4. Read `status` from JSON. For `started`, show a local notification with title.
   For `ended` or `awaiting_page`, Open URLs using the returned `finish_url`.
   Ignore `duplicate_ignored`. Show a useful message for 409/401/503 responses.
5. Test two deliberate scans more than 10 seconds apart; enter page and Save.

The tag need not store a secret. Notifications belong entirely to the Shortcut.
On iOS, the Shortcut may launch the installed PWA using its root `webapp://` URL.
Because iOS does not reliably preserve the hash route in that scheme, an authenticated
home/root launch checks for the newest ended NFC session whose page entry is still
pending and replaces the route with its existing finish screen. The same check runs
when an already-open PWA returns to the foreground, using visibility/focus lifecycle
events with request deduplication. Explicit non-home routes are never overridden.
Normal HTTPS finish links remain valid fallbacks, and direct finish-route reloads
remain supported.

## Deployment and rollback

Production Pages URL confirmed with `gh api repos/bojango/Librariangpt/pages`:
`https://bojango.github.io/Librariangpt/`. The function defaults to that verified
URL. No new secret setting is required. For a different frontend deployment, set
the Edge Function environment variable `READING_ROOM_BASE_URL` to its HTTPS base
URL (including any path); no query/hash or credentials. The function fails before
mutation if the configured base URL is invalid.

Apply only migration `20261001190514_nfc_reading_sessions.sql`, then deploy the
`nfc-reading-session` function with gateway JWT verification disabled. Never
replay the historical snapshot. Some historical local filenames differ from live
migration versions; the NFC migration is additive and was checked against live.
GitHub Pages normally deploys main; publishing this branch requires a separate
manual dispatch of the existing Pages workflow on this branch, without merging.

To roll back: disable bookmarks/stop the Shortcut, remove the Edge Function,
restore the previous Pages deployment, export any wanted NFC history, then apply
`supabase/rollback/nfc_reading_sessions.sql`. It removes only NFC objects. If NFC
progress logs exist, it deliberately retains their source and the additive source
whitelist; erasing or rewriting existing progress is not part of rollback.

Tests: unit suite executes the real migration/RPCs in embedded PostgreSQL, plus
the real Edge handler. E2E uses the built app on desktop and iPhone. Live API smoke
tests use a transient bookmark, never submit production progress, and delete that
bookmark/timed history afterward. Compare canonical table fingerprints before and
after deployment/testing; investigate only new advisor findings from this feature.

Verified live on 2026-10-01: migration version `20261001190514` and Edge Function
version 1. Stored migration SQL matches the checked-in SQL (ignoring surrounding
whitespace). Synthetic acceptance tests roll back; real HTTP tests passed invalid/
disabled authentication, start/end, concurrent debounce and awaiting-page behaviour.
All temporary NFC rows were deleted. Existing library entries (62), lifecycle
sessions (10), progress logs (45), and library events (677) retained identical row
fingerprints. No new security findings; fresh-index unused notices are expected
and indexes are retained for FK coverage/history queries. Existing advisor issues
were left untouched. No permanent bookmark token has been created.
