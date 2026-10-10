# Private profile and activity feed

Profile opens on Feed. Going back from a book retains the selected tab. Stats retains the existing Reading Record and NFC time aggregates; NFC configuration is in the burger menu accordion. Identity edits save existing `reader_profiles` fields through the existing owner policies; the avatar uses the private storage bucket. `#0001` is a display label only.

The card summary and Taste Details share `tasteIdentity`. Strong positive signals require Medium/High confidence and at least two evidence records. Genre labels use only the primary genre of books linked by positive supporting evidence. Negative, mixed, unknown and low-confidence signals stay visible with their direction/confidence; genres are never inferred from prose. Book evidence is displayed with its recorded relation and weight.

The identity card uses an aligned two-column photo/identity row and equal-width centred statistics. A shared presentation taxonomy consolidates explicitly recorded subgenres into readable categories (for example hard science fiction into Sci-Fi, or travel writing into Nonfiction), deduplicates case-insensitively, and ranks up to five labels by distinct supporting books. It never fills missing categories from signal prose or reader identity.

The personal summary groups related signal dimensions, selects complete sentences from the strongest reliable themes, and changes their voice to first person. It retains conditions, shows mixed/conflicting evidence as mixed, softens Medium-confidence statements, and marks an emerging-only profile as tentative. Both the card and Taste Details consume the same result; canonical preferences remain unchanged. The card clamps only its three-line preview with CSS, while the expanded text retains the complete generated paragraphs. Expansion animates height and respects reduced motion. History separates dates from duration/rating/genre and wraps all metadata instead of ellipsising it. Feed padding is reduced while quote spacing and link/control sizes are retained.

## Capture and consistency

`activity_events` is Supabase's canonical timeline. Four database triggers capture changes to `library_entries`, `reading_sessions`, `book_quotes` and `taste_profile`, regardless of writer. Metadata, timestamps, enrichment and unchanged saves are ignored. Session starts/completions use session identity so rereads remain distinct. Library and session changes within a transaction coalesce. Rating changes have separate events except in the finishing transaction; completion cards reflect later rating corrections. Progress captures 25/50/75 percent crossings once per session, with a library fallback only when no session exists. Correcting a page total does not create a milestone.

Quote events use the quote ID as their permanent key. Edits update metadata on that same event and retain its saved date; deletion cascades. The editor preserves the entered quotation verbatim and uses a stable new quote UUID across a failed-save retry. All content is escaped as text, including multiline quotations and personal notes.

The migration backfills session start/completion dates, saved quotes, explicit wishlist/order logs, and dated library reads without sessions. It does not infer historical wishlist or purchase dates from current status. Re-running `private.backfill_activity()` is safe and restricted to database management; it creates no invented editorial entries.

The API uses descending `(occurred_at, id)` keyset pagination. Owner RLS applies before pagination. Profile rendering does not await feed requests. While Feed is visible, changes from external workflows refresh every 30 seconds; opening Profile, foregrounding the app and pull-to-refresh also refresh the data. Changing users clears the cached feed. Supabase remains the only persistent activity store.

## Authenticated Librarian insertion

For ChatGPT/tools with the library owner's authenticated Supabase session:

```js
const { data: eventId, error } = await supabase.rpc('add_librarian_entry', {
  p_source: 'librarian',
  p_content: reflection, // Real observation; do not fabricate activity.
  p_idempotency_key: stableWorkflowEventKey,
  p_book_id: bookId ?? null,
  p_tags: ['progress']
});
```

For the existing trusted server/Edge automation using its service-role JWT, use **`add_automation_librarian_entry`** with the same parameters. It resolves the owner from `private.app_state`, rejects book references outside that owner's library and accepts no caller-supplied owner. Its invoker wrapper is executable only by `service_role`; its private definer checks that role again and has an empty search path. Keep service credentials exclusively on the backend. No new scheduler is installed.

Both APIs accept `system`, `user`, `librarian` or `automation` as source. The rendered author is always **Librarian**. Tags omit `#`, contain lowercase letters/digits/underscores, have a maximum length of 40, and are limited to 20 tags. `#librarian` is added automatically. Content must be nonblank and at most 12,000 characters; a caller key is required and at most 220 characters. The same owner/key returns the existing event ID without creating or overwriting a post. Use a key for the workflow occurrence, not a new UUID on each retry. A subsequent editorial post requires a different occurrence key.

Ordinary clients can read only their own private events and insert owner-scoped editorial/future manual posts. They cannot update/delete canonical events or forge reading events. Anonymous access is revoked. No public feed is exposed.

## Verification and Pages review

Applied migrations: `20261010110322_private_profile_activity.sql` and `20261010110712_automation_librarian_entries.sql`. Filenames match Supabase's recorded deployment versions. The first migration reconstructed 48 substantiated historical events (12 started, 8 finished, 11 wishlist, 10 bought, 7 quotes); no Librarian entries were fabricated. Live rollback assertions passed for both endpoints and all four triggers, including anonymous/cross-owner denial and canonical-event spoof prevention. Security advisors reported no findings for the new table or functions; inherited advisories concern existing privileged APIs, existing internal tables without client policies, and Auth password protection.

Validation on Windows: `npm ci` during the initial implementation, followed by `npm run build`, `npm test` (329 passed), `npm run check` (60 modules passed) and `npm run test:e2e` (193 passed, one intentional desktop skip for mobile-only navigation). Tests include Chromium and WebKit/iPhone 13, production-bundle HTTP fixtures, long usernames/quotes, all four tabs, profile saves and private avatar uploads, filtering/keyset loading, timestamps, Stats regressions, chronological rereads, NFC token configuration from the menu, failure/retry states, and PWA-controlled generation coherence. Profile screenshots were visually reviewed in both skins. Polish regression coverage measures photo/badge/genre alignment, equal-width centred statistics, three-line preview clamping and overflow at 320/375/390/430 pixels, plus complete expanded prose, genre consolidation, History wrapping, feed padding, and custom colours/radii.

`tests/unit/activity-database.test.js` runs the actual migrations with PostgreSQL/PGlite, including cross-owner and anonymous denial. `tests/sql/profile-activity-live.sql` tests the installed functions and triggers on Supabase inside an explicit rollback; temporary users, books, activity and owner substitution are never retained. `tests/e2e/profile-feed.spec.js` runs the production bundle against intercepted HTTP fixtures in Chromium and iPhone WebKit, with no real-library writes.

PWA generation 117 versions HTML, CSS, JavaScript and the shell cache together. The worker deletes older shell caches; navigation uses network-first HTML. An already-open installation should be closed and reopened to load the updated document.

Deploy review with the existing workflow: `gh workflow run deploy-pages.yml --ref feat/profile-feed-redesign`. This temporarily serves the feature at `https://bojango.github.io/Librariangpt/` without merging. Roll back by running the same workflow with `--ref main`; additive activity migrations remain compatible with main.
