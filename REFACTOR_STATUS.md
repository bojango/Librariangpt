# Reading Room architecture refactor status

Branch: `refactor/architecture-foundation`

Last updated: 2026-09-10

## Permanent diagnostic Test Mode (2026-09-10)

- Added an opt-in recorder in `src/diagnostics/` with one central API, deterministic per-session sequences, compact sanitised events, batched IndexedDB persistence, unfinished-session recovery, a 5,000-event cap, critical-event preservation, and idempotent batch upload. When Test Mode is off, IndexedDB is not opened and lifecycle/data/cover hooks are not installed.
- Added a menu-only Test Mode control, active code/event summary, immediate issue categories, end/upload and end-local actions, recent-session copy/retry, plus a small static TEST topbar indicator.
- Instrumented existing explicit app/auth/router/paint/scroll/title/cover/data/service-worker/error boundaries without changing their policies or timing decisions. Every existing application-owned `window.scrollTo` now passes through a reason-labelled recorder before retaining the same call semantics.
- Bumped the coherent PWA shell to generation 46 solely so the new bundle/CSS/worker diagnostic protocol deploy together. Navigation, static asset, cover, and Supabase caching policies are otherwise unchanged. The worker counts cover cache hits/misses/network fetches only while enabled and returns those aggregates on request at start, issue markers, and session end.
- Added `window.__RR_TEST__` only while enabled (or via `?test=1`) for local session/event inspection and Playwright markers. It exposes no Supabase client, credentials, tokens, or private application records.
- Deployed and committed additive diagnostic migrations `20260910194645`, `20260910194728`, and `20260910194958` for `diagnostic_sessions`/`diagnostic_events`, authenticated owner-only RLS, least-privilege authenticated grants, no anonymous grants, and unique `(session_id, sequence)` upload idempotency. Verification found both tables empty, RLS enabled, six owner policies present, and only SELECT/INSERT/UPDATE table privileges for `authenticated`. No Library table or row was modified.
- Privacy rules, taxonomy, collection/upload workflow, SQL lookup, extension rules, and intended approximately 14-day retention are documented in `docs/DIAGNOSTICS.md`.
- Diagnostic unit/browser coverage verifies disabled zero-write behavior, ordering/timestamps, issue persistence, sanitisation, cap preservation, idempotent upload, route/paint/title/cover evidence, lifecycle events, programmatic scroll reasons, and same-cover reuse.
- Final verification: build passed (`dist/app.js` 247.7 kB); unit tests 31/31; architecture check passed across 30 modules; full Playwright passed 54/54; explicit iPhone 13 WebKit passed 27/27; `npm audit` found 0 vulnerabilities; `git diff --check` passed. The diagnostic migration is recorded in remote migration history, both new tables have RLS enabled, and post-migration advisors introduced no new security/performance finding beyond expected unused indexes on the still-empty diagnostic tables.
- Guardrail audit: production still has one `createClient(` and zero `MutationObserver`, `ResizeObserver`, `IntersectionObserver`, or `location.reload`. The sole `scrollHeight` read is Test Mode-only checkpoint geometry. The sole `window.scrollTo` is the reason-labelled wrapper preserving existing calls. The new 800 ms `setTimeout` only bounds a Test Mode service-worker message when an older worker cannot answer; existing edition polling and toast dismissal remain the other two timers. Existing `innerHTML` writes remain trusted/escaped route, modal, and menu renderers; diagnostic history is escaped before its scoped menu write. Existing `scrollRestoration`, `visibilitychange`, `pagehide`, and `pageshow` application behavior was not changed; Test Mode adds removable listeners only while enabled.
- Exact next step: collect and upload physical-iPhone sessions for Home launch, book-detail resume, and cover flashing. Do not fix the lifecycle bugs until those session codes have been examined chronologically.

### Physical-iPhone diagnostic collection

- Session A: start fresh, fully close/reopen from Home Screen, mark title/scroll/cover/page issues immediately, scroll and background for about 30 seconds, then end/upload and retain the code.
- Session B: start fresh, open a book, scroll near the bottom, background for about 30 seconds, mark any return jump, then end/upload and retain the code.
- Session C: start fresh, navigate Home → Library → Wishlist repeatedly, mark cover/page flicker immediately, background/foreground once, then end/upload and retain the code.
- The next repair task must use those three codes. No current iOS title, cover, render, scroll, auth, or resume behavior was changed in this instrumentation task.

## Completed phases

- Inventoried the original entry points, runtime scripts/styles, service worker, Supabase access, navigation, caches, observers, timers, reloads, listeners, and feature ownership.
- Replaced the layered browser runtime with a framework-free ES-module application and one production bundle.
- Established one Supabase browser client, a repository/service boundary, in-flight GET deduplication, one application state store, and one hash-route lifecycle.
- Moved Home, Library, Wishlist, Stats, book detail, reading actions, add-book, queue, recommendations, ratings, quotes/OCR, editions, exact-copy cover tools, and book administration into explicit views/features.
- Added render tokens so stale async detail/enrichment work cannot repaint a newer route.
- Added per-route scroll restoration and carousel restoration using session state only.
- Consolidated the production cascade into one stylesheet while retaining the existing visual rules and adding stable cover/modal/mobile constraints.
- Replaced the service worker with explicit shell, navigation, static-asset, cover, and Supabase-network policies.
- Exported current Supabase migration history and all deployed Edge Function sources without writing to production.
- Removed the superseded versioned production scripts/styles after the replacement passed browser tests.
- Added unit, architecture, and Playwright test foundations.

## Architecture before and after

| Concern | Before | After |
|---|---|---|
| Entry | `app.js` plus 14 enhancement scripts | `dist/app.js` built from `src/app.js` |
| Styling | 18 ordered override stylesheets | `src/styles/app.css` |
| Supabase client | Re-created across independent scripts | One client in `src/data/supabase.js` |
| Data lifecycle | Repeated queries plus monkey-patched response caches | `src/data/library.js`, canonical network reads, in-flight dedupe |
| State | Script globals and DOM discovery | `src/state.js` authoritative loaded UI state |
| Navigation | In-memory navigation plus reload/back patches | One GitHub Pages-safe hash router in `src/router.js` |
| Rendering | Base DOM followed by observers/injectors | Single-pass route views with explicit feature slots |
| Writes | Local patches, duplicated invalidation, reloads | Service writes followed by scoped state refresh/rerender |
| PWA cache | Versioned patch-file shell | Clean v43 shell; network-first HTML; bounded cover cache; Supabase API bypass |

Runtime flow:

```text
Supabase -> src/data -> src/state -> src/router -> src/views -> src/features
```

## Current module ownership

- `src/app.js`: authentication, render lifecycle, delegated events, route cancellation, service-worker registration.
- `src/data/supabase.js`: sole browser client and identical in-flight GET deduplication.
- `src/data/library.js`: snapshots, detail records, RPC/function boundaries, optional provider datasets.
- `src/state.js` and `src/router.js`: central state, scroll state, route parsing/navigation.
- `src/views/`: direct Home, Library/Wishlist, Stats, book-detail, auth, and loading markup.
- `src/features/`: add-book, reading updates, current-reading/queue/recommendations, quotes/local OCR, editions, exact-copy tools, and admin workflows.
- `src/ui/`: stable navigation/chrome, formatting, modals, and toast feedback.
- `src/utils/`: tested identity, matching, metadata confidence, rating, cover, and progress logic.

## Post-refactor iPhone QA fixes

### Same-route refresh scroll reset

- Root cause: `refresh()` reused the route-entry renderer. Home/Library therefore scheduled saved-scroll restoration after every background data refresh, and the stored value could still be `0` while the user had already begun scrolling.
- Contributing cause: token refresh/repeated `SIGNED_IN` events were treated as a changed session because access tokens changed, causing unnecessary snapshot loads and route renders.
- Fix: navigation and same-route refresh are explicit modes. Route-entry scrolling runs only for navigation. Refresh captures the live viewport, skips repaint when the relevant data fingerprint is unchanged, and preserves the current viewport when changed data requires a repaint. Concurrent snapshot requests now share one promise.

### Cover snap/flicker

- Root cause: image elements were visible as soon as the network decoded them, and every full repaint destroyed unchanged cover nodes.
- Fix: `src/ui/cover.js` reserves a 2:3 fallback box, defers image reveal until load/decode, leaves failures on the fallback, rejects disconnected/stale loads, and reuses in-flight or decoded image nodes when book identity and URL are unchanged.
- The first Currently Reading cover and first visible catalogue rows are promoted to eager/high priority; remaining covers stay lazy.

### Edition update leaving the book

- Root cause: edition completion dispatched the undifferentiated global library refresh, which discarded detail state and re-entered the full snapshot/route lifecycle.
- Fix: a refresh raised while a book is active is now book-scoped by default. It invalidates/refetches that book detail, patches the matching central-state row, preserves the book route and scroll position, and never runs Home route entry.

### Home incomplete until scrolling

- Root cause: the same unnecessary full route rebuild could leave Safari repainting a newly replaced document while covers and carousel work were reinitialized.
- Fix: unchanged data performs no DOM write; changed data reuses covers, all Home shelves remain synchronously present in `homeView`, and explicit CSS prevents content-visibility from deferring core sections. No primary rendering is scroll-driven.

## Removed obsolete production modules

Removed the old root runtime and every superseded referenced/unreferenced patch generation: `app.js`, `data-cache.js`, `cache-hooks.js`, `ui-v3.*`, `chapter-addon.js`, `chapter.css`, `book-admin-v15.*`, `up-next-v16.*`, `recommended-v23.*`, `edition-browser-v20.*`, `exact-copy-v22.*`, `cover-upload-v25.*`, `library-admin-v30.*`, `current-reading-carousel-v36.*`, `current-reading-layout-v37.*`, `quotes-v40.*`, `styles.css`, `branding-v27.*`, `cover-addon.js`, `detail-v2.*`, `metadata-addon.js`, `metadata-pipeline-v34.js`, `perf-v14.*`, `refresh-data-v19.js`, `stability-v32.*`, `stability-v41.css`, `ui-fixes-v24.*`, and `wishlist-consistency-v33.js`.

`index.html` now references one stylesheet and one bundled module.

## Supabase/backend status

- Production data, schema, Auth configuration, deployed functions, and secrets were not modified.
- Exported all 34 deployed migration-history statements, in order, to `supabase/migrations/`.
- Exported all 11 active deployed functions to `supabase/functions/<name>/`, with deployed version, JWT setting, checksum, and export time in `deployed.json`.
- Function secrets remain runtime `Deno.env.get(...)` references. A historical one-time claim code and personal source label found in the first migration were redacted before commit.
- The frontend preserves independent bibliographic, cover, edition, and public-rating data paths. Exact ISBN matches are verified; trusted/exact edition identity wins over fuzzy enrichment; provider failures cannot erase trusted metadata.
- `book-metadata` remains deployed with gateway `verify_jwt: false`; its current source performs caller/owner validation. This was preserved, not redeployed or endorsed.

Read-only Supabase advisors reported:

- Error: `public.v_library` is a security-definer view.
- Warning: authenticated users can execute security-definer `public.admin_edit_book(...)`.
- Warning: leaked-password protection is disabled.
- Info: `book_quotes.book_id` and `book_quotes.edition_id` foreign keys lack covering indexes.

These findings need a development Supabase branch and explicit backend review. No speculative production migration was created.

## Caching and intentional asynchronous primitives

- Canonical library data is always loaded from Supabase; there is no persistent `localStorage` data cache.
- Identical in-flight Supabase GETs are deduplicated in one place.
- `sessionStorage` is used only for route scroll positions, carousel position, and a background-enrichment throttle timestamp.
- The only frontend `setTimeout` calls are bounded edition-enrichment polling and toast dismissal.
- `requestAnimationFrame` is limited to one-time scroll restoration and carousel paint/scroll coordination.
- There are no frontend `MutationObserver` or `location.reload` calls.
- The only frontend `createClient(` is the shared client. Edge Functions create server-side clients per invocation for authenticated/user and service-role scopes.
- Scroll restoration now runs once for actual route navigation. Same-route refresh uses the live viewport and never reads route-entry scroll state.

## Tests run and results

Final clean-install run on Node 24.15.0:

- `npm ci`: passed; 20 packages installed.
- `npm run build`: passed; `dist/app.js` 220.1 kB and source map 772.3 kB.
- `npm test`: passed, 17/17 unit tests.
- `npm run check`: passed; 25 runtime modules, zero observers/reloads, exactly one browser client.
- `npm run test:e2e -- --reporter=line`: passed, 32/32 across desktop Chromium and iPhone 13 WebKit profiles.
- `npm run test:e2e -- --project=iphone --reporter=line`: passed, 16/16.
- `npm audit`: passed; 0 known vulnerabilities.
- `git diff --check`: passed.
- Service-worker asset resolution: passed in both browser projects.
- Production Supabase inspection and advisor checks were read-only.

Unit coverage includes ISBN normalization/exact mismatch rejection, result deduplication, title/author matching, metadata-confidence ordering, trusted-data preservation, provider-ID reuse, independent ratings, edition progress conversion, cover priority, route parsing/round-tripping, independent scroll state, stale-render rejection, route identity, and snapshot/detail change detection.

Browser coverage includes cold unauthenticated launch, auth-mode lifecycle, direct Home rendering without scroll, Home/Library/Wishlist navigation, rapid Home→Library→Home, filtering, book open/back, filter-state preservation, same-route refresh at scroll depth, unchanged-refresh repaint suppression, delayed and failed covers, stale-cover rejection, first-viewport priority, edition mutation preserving the exact book route, Home structure after that mutation, mobile overflow, and PWA shell assets. Authenticated flows use mocked Supabase responses and do not write production data.

## Remaining work / known issues

- Re-run the focused lifecycle checklist on a real iPhone/4G. Playwright passing does not establish physical-device behavior.
- Quotes/OCR still need their first post-refactor manual test with a physical book; camera capture and copyrighted page images must remain local/temporary.
- Check install/update behavior, safe areas, carousel swipe, camera/file OCR, cover upload/crop, and background/foreground restoration on a physical iPhone in standalone PWA mode.
- Progress, add-book, enrichment, and edition selection were reported working in owner QA. Continue using a disposable test book for any destructive/manual write checks.
- Provider failure/slow-network behavior is covered at pure-logic and deterministic-view boundaries, but not by live third-party fault injection.
- The consolidated CSS intentionally retains some legacy selector-level rules to preserve the computed design. Semantic pruning is optional and should follow screenshot baselines, not be mixed into this refactor.
- The four Supabase advisor findings above remain unresolved until a safe backend branch exists.

## Deployment and exact continuation steps

1. Review this branch; do not merge automatically.
2. Run the manual authenticated/iPhone checks above.
3. If accepted, deploy the repository root to GitHub Pages with committed `dist/` artifacts. No database migration or Edge Function deployment is required for the frontend release.
4. Provision a Supabase development branch before changing backend security, indexes, migrations, or deployed functions.
5. Compare the exported backend snapshot to that branch, replace the redacted bootstrap value through a reviewed environment/deployment mechanism if a full fresh replay is ever required, then test before deployment.
6. For future frontend work: change `src/`, run `npm run build`, `npm test`, `npm run check`, and `npm run test:e2e`, then commit `dist/`.

### Real iPhone checklist

1. Cold-launch the installed PWA.
2. Open Home and immediately scroll.
3. Wait 5–10 seconds; confirm there is no snap to top.
4. Open Wishlist over 4G; observe covers decoding over stable fallbacks.
5. Navigate Home → Library → Book → Back and confirm scroll restoration.
6. Change an edition and confirm the same book remains open.
7. Return Home and do not touch the screen for several seconds.
8. Confirm Currently Reading, Up Next, recommendations, and all other structural shelves are present.
9. Navigate rapidly for roughly 30 seconds.
10. Background and foreground the PWA; confirm the active route and viewport remain sensible.

The branch is intended to remain review-only until the manual authenticated checks are complete.

## Final first-paint polish (2026-09-10)

- The Currently Reading title had no deterministic size class in its initial markup. `currentTitleClass()` now classifies titles from character count, word count, and longest-word length before rendering; iOS text inflation is explicitly disabled with `text-size-adjust: 100%` while the 290px hero height and existing type styles remain unchanged.
- Cover markup previously withheld `src` in `data-cover-src`, then activation assigned it and an opacity gate revealed all decoded images. Covers now start loading from initial HTML, remain in the same absolute 2:3 box over the fallback, and are never deliberately faded or hidden while loading. Failure handling, URL-staleness checks, and same-URL image-node reuse remain intact.
- Priority is decided during rendering: the first Currently Reading cover and book-detail cover are eager/high, the first six catalogue cards are eager (first three high), and offscreen cards remain lazy. Shell assets were bumped to v44 so installed PWAs receive the changed bundle and CSS normally.
- Added pure title-classification and cover-markup/CSS tests, plus browser regressions for first-markup title class stability, immediate cover `src`, no opacity gate, failed-cover fallback, invariant geometry, stale URL rejection, node reuse, and loading priority.
- Results: build passed (220.0 kB bundle); unit tests 20/20; architecture check passed (25 modules); full Playwright 34/34; explicit iPhone 13 WebKit 17/17; npm audit 0 vulnerabilities; `git diff --check` passed.
- Remaining QA is real-device only: cold-launch/reopen the Home Screen PWA several times, inspect the long title and Home covers, observe Wishlist covers over 4G, navigate Home → Library → Book → Back, refresh while covers are visible, and background/foreground the PWA. Automated browser results do not replace this physical-iPhone confirmation.

## Installed-PWA lifecycle QA (2026-09-10)

- Title root cause: classification was deterministic, but final typography still existed only as a class-to-stylesheet relationship. There was no post-render fitter and the v44 service-worker test found no mixed CSS/JS generation; the weak point was that a restored/cached document could display generic hero typography whenever that class/cascade state was absent. Compact/tight headings now include their final `font-size` and `line-height` inline in the initial HTML as well as the semantic class and variant attribute. “The Unfinished Harauld Hughes” is covered directly; short titles retain generic large type.
- Cover group-flash root cause: every route paint replaced all of `#app`, including persistent chrome, and legacy stability CSS promoted every cover to a GPU layer with `translateZ(0)`/`backface-visibility`. WebKit could composite those recreated layers together. Route paints now preserve the topbar and bottom navigation, replace only `<main>`, pre-reconcile reusable cover nodes before attachment, and no longer force cover GPU layers. Identical snapshots still perform no paint.
- Resume-scroll root cause: ordinary scrolling was not persisted, so a killed/relaunched document could restore stale route state (often zero) over iOS’s visible viewport. Route DOM changes could also emit transient scroll events while ownership changed. A passive animation-frame-throttled listener now persists Home/Library/Wishlist; hidden and `pagehide` flush the live position; persisted `pageshow` only cancels pending app restoration. Resume/foreground never calls `scrollTo`. Route paint suppresses transient persistence, captures the target position before DOM replacement, and uses manual history restoration so only actual route navigation owns route scroll.
- Genuine internal route changes animate only the newly inserted `<main>` for 160ms from opacity `.94`/translateY `4px` to its final state. Startup, same-route refreshes, data mutations, auth refresh, foreground/resume, and bfcache restoration do not transition. The persistent topbar/bottom navigation never moves. `prefers-reduced-motion: reduce` prevents the class and animation entirely.
- Service worker: navigation remains network-first; static generation 45 is coherent across HTML, CSS, JS, and shell cache, and canonical Supabase responses remain uncached. A real service-worker-controlled reload test passes in both browser profiles. No forced reload/update loop was added.
- Lifecycle primitives retained intentionally: three `window.scrollTo` sites cover explicit route restoration, same-route viewport preservation, and opening a book at the top. `history.scrollRestoration = 'manual'` prevents native hash-history competition while same-document PWA resume remains untouched. `visibilitychange`, `pagehide`, and persisted `pageshow` only save/cancel scroll state. Top-level `template.innerHTML` parses trusted escaped view markup; remaining `innerHTML` writes are scoped modal/feature renderers. Existing `setTimeout` calls remain limited to bounded edition polling and toast dismissal.
- Final results after rebuilding `dist/`: build passed (223.0 kB); unit tests 25/25; architecture check passed (26 modules); full Playwright 46/46; explicit iPhone 13 WebKit 23/23; service-worker-controlled reload passed in Chromium and WebKit; npm audit found 0 vulnerabilities; `git diff --check` passed.
- Remaining physical QA: repeat cold/relaunch, cover, scroll-resume, route-return, transition, and Reduce Motion checks below. Quotes/OCR remains a separate manual physical-book check. Automated WebKit coverage does not establish standalone-iPhone behavior.
