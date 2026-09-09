# Reading Room architecture refactor status

Branch: `refactor/architecture-foundation`

Last updated: 2026-09-09

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
| PWA cache | Versioned patch-file shell | Clean v42 shell; network-first HTML; bounded cover cache; Supabase API bypass |

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

## Tests run and results

Final clean-install run on Node 24.15.0:

- `npm ci`: passed; 20 packages installed.
- `npm run build`: passed; `dist/app.js` 216.6 kB and source map 760.1 kB.
- `npm test`: passed, 14/14 unit tests.
- `npm run check`: passed; 23 runtime modules, zero observers/reloads, exactly one browser client.
- `npm run test:e2e -- --reporter=line`: passed, 16/16 across desktop Chromium and iPhone 13 WebKit profiles.
- `npm audit`: passed; 0 known vulnerabilities.
- `git diff --check`: passed.
- Service-worker asset resolution: passed in both browser projects.
- Production Supabase inspection and advisor checks were read-only.

Unit coverage includes ISBN normalization/exact mismatch rejection, result deduplication, title/author matching, metadata-confidence ordering, trusted-data preservation, provider-ID reuse, independent ratings, edition progress conversion, cover priority, route parsing/round-tripping, independent scroll state, and stale-render rejection.

Browser coverage includes cold unauthenticated launch, auth-mode lifecycle, direct Home rendering, Home/Library/Wishlist navigation, filtering, book open/back, filter-state preservation, rapid route changes, current-reading carousel markup, rating/quote/detail rendering, failed-cover geometry/fallback, mobile overflow, and PWA shell assets. Authenticated flows use deterministic fixtures and do not write production data.

## Remaining work / known issues

- Perform a manual authenticated smoke test against the owner's real library; no credentials were available to automate this safely.
- Check install/update behavior, safe areas, carousel swipe, camera/file OCR, cover upload/crop, and scroll restoration on a physical iPhone in standalone PWA mode.
- Verify each production write workflow manually with a disposable test book or a future isolated Supabase branch: progress, status, review, quote, edition switch, cover selection/upload, add, and delete.
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

The branch is intended to remain review-only until the manual authenticated checks are complete.
