# Reading Room architecture refactor status

Branch: `refactor/architecture-foundation`

Last updated: 2026-09-10

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
