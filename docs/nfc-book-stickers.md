# NFC book stickers

A book sticker opens a book; the existing reading bookmark starts/ends a timer.
They use distinct Edge Functions and database operations, with the same existing
NFC capability token. Opening a book never creates reading sessions, time rows,
progress, library events, or statistics, and never changes its reading status.

```text
Physical NFC sticker inside a book
→ iOS Personal Automation registered for that sticker
→ matching Reading Room book UUID
→ reusable Shortcut
→ nfc-open-book Edge Function
→ one pending navigation request for the owner
→ webapp://bojango.github.io/Librariangpt/
→ PWA retrieves and consumes destination
→ existing #/book/<UUID> page
```

Stickers do **not** need URLs written to them. Reading Room does not know or store
Apple's NFC automation tag identifier. Each per-sticker iOS automation supplies
the matching book UUID to the reusable Shortcut. Obtain it from the book page:
expand **Book & edition details**, then select **Copy NFC book ID**. This copies
the canonical book UUID, not a library-entry or edition ID.

Shortcut setup is intentionally deferred until this implementation has been QA'd.
No Shortcut or NFC registration UI is created by this change. The future reusable
Shortcut contains the endpoint, existing capability token, JSON POST, and generic
PWA root launch. Do not put a book hash/path in `webapp://`: iOS can discard it.
Do not include a Supabase API key, JWT, service-role key, or database credentials.

## Backend API contract

`POST https://fbbpovieqfsjunmqtxvf.supabase.co/functions/v1/nfc-open-book`

Headers:

```http
Content-Type: application/json
X-NFC-Bookmark-Token: <existing bookmark UUID>.<existing 64-lowercase-hex secret>
```

Body:

```json
{"book_id":"<canonical Reading Room book UUID>"}
```

Success, HTTP 200:

```json
{"status":"queued","book_id":"<UUID>","book_title":"Gateway"}
```

Failures return only a status, without token hashes or other-user metadata:

| HTTP | JSON status | Meaning |
| --- | --- | --- |
| 400 | `book_not_found` | Missing/malformed book UUID or invalid JSON |
| 401 | `unauthorized` | Malformed, incorrect, disabled, revoked, or non-owner capability |
| 404 | `book_not_found` | UUID missing from the canonical owner's library |
| 405 | `method_not_allowed` | Method other than POST |
| 503 | `temporarily_unavailable` | Backend failure; request can be retried |

Launch the root only after `queued`. Any library status is eligible, including
Read, Wishlist, Recommended, Paused, DNF, and Owned - Unread.

## Request lifecycle and security

`public.app_navigation_requests` has `user_id` as its primary key, `book_id`,
`requested_at`, and `source='nfc_book'`. Upsert replaces an unresolved older tap.
The bounded queue holds at most one row per user. Consumption deletes the row;
there is no accumulating history. A deleted book cascades away its request;
a removed library entry is rechecked and discarded during consumption.

`queue_nfc_book(uuid,text,uuid)` is SECURITY INVOKER and executable only by
service_role. The Edge Function performs the existing SHA-256/constant-time
capability validation, and the RPC rechecks enabled/hash/canonical owner under
the bookmark lock. It locks and verifies the owner's library entry for any status.
It does not touch bookmark defaults, pinned book, last-tap time, or token.

RLS allows only canonical-owner, own-user SELECT. Anon has no table access;
authenticated browsers have no INSERT/UPDATE/DELETE and cannot call the queue RPC.
Token hashes retain their existing column restrictions. Service credentials live
only in the Edge entrypoint's environment.

`nfc_app_destination(p_include_book boolean default false)` is an authenticated
SECURITY INVOKER public wrapper around a private SECURITY DEFINER function.
Private elevation is needed solely to delete a request without browser write
grants. It uses an empty search_path, explicit EXECUTE revokes/grants, auth.uid()
and private.is_owner() checks, and never accepts a user ID. It takes the same
per-user NFC transaction lock as the reading-bookmark tap and invokes the existing
session destination function before touching navigation state. Atomic DELETE
RETURNING lets only one client retrieve a given request. Network failure after
the server consumes a response has at-most-once semantics; rescan to queue again.

## PWA lifecycle

The existing cold-start, visibilitychange, focus, identity/route guards, and
overlapping-check deduplication are reused. No extra focus listener is installed.
Only Home/root checks pass `p_include_book=true`; Active/Choose checks still
reconcile reading sessions but preserve queued books. Explicit Profile and Book
routes do not run destination checks. Returning to Home can consume on the next
legitimate startup/resume check. Navigation uses the existing router and book loader.

Priority is:

1. Ended timed session awaiting page submission → Finish Session.
2. Running timed session → Active Session.
3. Pending reading-session selection → Choose Book.
4. Pending explicit book request → normal book page.
5. Otherwise → Home.

Higher-priority states preserve the book row. Resolving a session still follows
the existing session flow; the book sticker waits for the next eligible Home check.
PWA generation 109 updates document asset URLs and the worker shell cache together.

## Verification

Run `npm test`, `npm run test:e2e`, `npm run build`, and `npm run check`.
`tests/unit/nfc-book-links.test.js` executes actual migrations in embedded PostgreSQL,
with role checks and rollback-isolated synthetic cases. The NFC E2E fixture checks
desktop/iPhone cold/warm routes, priority, consumption, clipboard, and old session
behavior. `tests/sql/nfc-book-links-live.sql` provides rollback-backed live schema,
role, priority, and mutation assertions using synthetic data only. The live Edge
probe uses a separate transient synthetic capability; it never uses or prints
the existing raw token. Clean all committed HTTP fixtures and their navigation
request after probing. Never change genuine reading/library records for QA.
Fixture books can trigger the existing metadata scheduler. Clean fixture-scoped
enrichment jobs/events as well, using their exact fixture UUIDs/job IDs, and
compare genuine table fingerprints before and after cleanup.
