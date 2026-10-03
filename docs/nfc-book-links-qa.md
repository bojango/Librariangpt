# NFC book links QA — 3 October 2026

Branch: `feat/nfc-book-links`.
Fetched and fast-forwarded parent: `feat/nfc-reading-sessions` at
`fbc2f6fef02380d92295dbaf848f01dbb2bd1d0f`. No merge performed.

| Check | Result |
| --- | --- |
| `npm test` | 271 passed; 0 failed |
| `npm run test:e2e` | 161 passed; 1 existing desktop skip for mobile navigation; 0 failed |
| Focused NFC E2E | 58 passed across desktop and iPhone profiles |
| `npm run build` | Passed; dist/app.js and source map regenerated |
| `npm run check` | Passed; 54 runtime modules |
| Source-map verification | Every embedded source matches its workspace file |
| `git diff --check` | Passed |
| Live rollback SQL | Queue, replacement, priority, consumption, role/grant assertions passed |
| Live HTTP | Disabled/malformed/wrong capability 401; malformed UUID 400; missing UUID 404; owned fixtures 200 with exact UUID/title; second destination replaces first |
| Live pending navigation after cleanup | 0 rows |
| Supabase migration | `nfc_book_links` applied to fbbpovieqfsjunmqtxvf |
| Edge Function | `nfc-open-book`, version 1, ACTIVE; custom capability auth |
| Existing Edge Function | `nfc-reading-session` version 2 untouched |
| PWA generation | 109 |

Security advisors match the pre-change baseline exactly: no new feature finding.
Existing findings: two INFO tables with RLS/no policy, one anon-executable public
definer finding, three authenticated-executable public definer findings, and
disabled leaked-password protection. These predate this feature. See
[Supabase database linter](https://supabase.com/docs/guides/database/database-linter)
and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Confirmed live RLS and grants: owner-only SELECT, no anon access, no authenticated
table writes/queue execution, no token-hash SELECT, service-only invoker queue,
authenticated invoker destination wrapper, and private owner-validated definer
consumer with empty search_path and explicit EXECUTE permissions.

Live HTTP fixtures used a separate random transient capability held only in
process memory. The existing raw token was neither retrieved, revealed, nor rotated.
All synthetic book/library/bookmark/navigation fixtures were deleted. Two synthetic
metadata jobs produced four scheduler events; those fixture-specific events were
removed and the jobs cascaded away with their fixture books.

After cleanup, counts and full-row fingerprints exactly matched the baseline for
books, library_entries, reading_sessions, reading_time_sessions, progress_logs,
library_events, recommendations, nfc_bookmarks, and nfc_pending_starts. Genuine
reading/library data and active bookmark settings are unchanged.

Browser coverage simulates iPhone/PWA lifecycle; physical NFC and the actual iOS
Shortcut remain deferred. Consumption is at-most-once: a network failure after
server-side retrieval may require scanning again, as documented in the API guide.
