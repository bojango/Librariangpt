# Collections and reading paths — review draft

Branch starts at current main `2bb5c7e` (20 October 2026). No main merge is part of this release.

## Preflight

The app is a vanilla ES-module SPA bundled with esbuild, using hash routes, canonical `v_library` statuses and an owner-only Supabase database. Four bottom-navigation destinations stay unchanged. Existing series are many-to-many through `book_series`; the flattened `v_library.series` field cannot represent all memberships.

Historical production migration timestamps differ from repository timestamps as documented in `reading-room-migration-reconciliation.json`. Never replay history, repair timestamps or use `db push --include-all` for this feature. The new migration is independently additive. No existing reading, wishlist, recommendation, edition or taste rows are updated.

Known Profile selector correction: hashtag chips use `hashtag:<tag>` whereas the top-level filters use event types. Tests now distinguish these. Clean unit baseline: 363 passed.

## Data contract

Verified catalogue works exist independently of Library entries. Memberships reference one work, so crossovers do not duplicate books. A catalogue work may link to an existing canonical `books.id`; it never creates a library entry, wishlist entry or recommendation. Existing `series` and `book_series` remain canonical for already-linked series; collection metadata supplements them for external titles and crossovers. Source and original publication year are distinct from edition metadata.

Personal paths store explicit user-confirmed order, selection (recommended/optional/skipped) and reasoning separately from official membership numbers. Initial suggestions use existing recommendation records in publication order and say that no personalised path has been saved. No score, position or Taste Profile preference is fabricated. Saving a path never changes the underlying recommendation history or reading status.

## Sources and scope

Catalogue evidence was checked on 20 October 2026. Source links travel with the catalogue. Pendergast includes the 23 published novels and the unnumbered short story Extraction; the origin novel retains its publication-series position. Nora Kelly has five published dedicated novels plus the announced 2027 title, explicitly labelled forthcoming. Thunderhead is a standalone introduction, not Nora Kelly #1. The Preston–Child universe in this first draft covers Pendergast, Nora Kelly and Thunderhead; it is explicitly scoped rather than claiming to include all collaborations. The crossover collection represents selected verified Nora/Corrie connections. Silo covers the core trilogy; short-story collections are outside that stated scope.

Author site: https://www.prestonchild.com/books/series/ and individual work pages. Publisher series: https://www.hachettebookgroup.com/series/douglas-preston/nora-kelly/ and https://www.hachettebookgroup.com/series/douglas-preston/agent-pendergast-series/ . Silo: https://hughhowey.com/series/silo/ . Jurassic Park: https://michaelcrichton.com/works/ . Reliquary copyright year cross-check: https://search.worldcat.org/title/Reliquary/oclc/39285732 . No canonical metadata is overwritten when a catalogue date differs.

## Deployment and rollback

The existing `deploy-pages.yml` accepts `workflow_dispatch` on a feature ref. Its deployment replaces the shared Pages frontend at https://bojango.github.io/Librariangpt/ . The github-pages environment requires a branch allow rule for this feature branch. Rollback: dispatch the same workflow with ref `main`; verify index, JS, CSS, manifest and service-worker generation together. Do not change the legacy Pages source branch or merge this feature to achieve a preview.

Production migrations require a verified restorable backup and explicit user approval. A fresh private logical archive was created on 20 October with all 88 table-data sections; full decoding and SHA256 validation passed with TLS `verify-full`. See `collections-backup-evidence.json`. A hosted restore was not performed; storage bytes are separate. The verified catalogue works before the new backend is available. Private path controls stay hidden; explicit Wishlist additions use the existing Library API and owner-scoped table privileges.

## Validation

Build passed; runtime architecture check passed (68 modules); full unit/integration suite: 374 passed, 0 failed. Eleven focused unit/database tests execute the additive migration and catalogue seed in isolated PostgreSQL (PGlite), testing canonical links, cross-series paths, atomic replacement, constraints, privileges and RLS for the owner, another authenticated user and anonymous access. Existing tables and recommendation history are untouched.

The new end-to-end scenarios exercise the shipped bundle and mutable isolated Supabase HTTP fixtures. They cover all three views, membership links, canonical ownership and reading counts, full versus personal order, path persistence, optional/skipped rows, external books, deep links and nested Back navigation, search/empty/error/retry, backend not yet migrated, mobile widths 320/390 and desktop, and both themes in Chromium and iPhone WebKit. These are browser/isolated-backend tests, not live owner authentication.

A full browser run found one pre-existing Profile fixture reload race (226 passed, 1 failed, 1 intentional skip). Waiting for the feed read to complete before reloading fixes the mocked WebKit cancellation. The affected scenario passed eight repeated browser/theme runs; the complete suite is rerun after that repair.

Final clean run: **227 browser tests passed, 0 failed, 1 intentional skip**. Full unit/integration rerun: **374 passed, 0 failed**. Build and runtime checks passed. PWA document, CSS/JS queries and service worker use generation 120.

Production schema and catalogue import are **approval-gated and not applied** in this review deployment. Until approved, the live frontend uses the verified public catalogue and existing owner-scoped books/series/recommendations; the reading-path editor is hidden. No local-storage substitute stores private paths. Approving the schema/seed later enables persistent owner-scoped path saving without a frontend redesign. The browser currently has no signed-in owner session, so genuine-data UI review requires sign-in. Run `node scripts/verify-pages-preview.mjs` after dispatch to verify deployed asset equality, every PWA shell asset, fresh cache/reload, both themes and mobile overflow in Chromium and WebKit.

## Visual refinement — 21 October 2026

Collections now starts with tighter Books / Collections tabs, search and an optional author-collection toggle. Cards reuse the homepage embossed material and charcoal primary buttons. Preston–Child appears once; Pendergast, Nora Kelly and character appearances are internal URL-addressable filters. Other existing series remain available. Michael Crichton is an optional view of known canonical titles, explicitly distinguished from an official series or complete bibliography; no author catalogue is imported.

Collection detail has a native horizontal cover shelf, approximately four covers across on mobile and centred for small collections. The full universe is grouped into official subseries with no repeated work rows. Publication year, official numbering, forthcoming labels and optional/skipped context remain distinct. Match scores use status pills. Full-collection progress counts every published title, including titles skipped in a personal path. Path progress excludes skipped and forthcoming works. Unsaved suggestions are labelled **Suggested Reads**, without fabricated path positions or unavailable editor controls.

On Book detail, Series & Collections follows the visible Book details section and shares its heading typography. Each parent collection has a short description, other-book cover shelf and pill-shaped Explore action. Overlapping child memberships do not repeat large shelves.

All 36 starter works have display-only artwork fallbacks with author/publisher provenance in `src/data/collection-artwork.js`. Discovery reads individual work pages or explicitly linked series-gallery book images; generic landing-page social artwork is excluded. Canonical and selected edition covers always take precedence. Reproduce discovery with `node scripts/discover-collection-artwork.mjs`.

An explicit **Add to library** action adds a missing title to Wishlist. It refreshes canonical title/author identity, rejects ambiguity and ISBN collisions, and coalesces repeated clicks. Existing canonical books use `INSERT … ON CONFLICT DO NOTHING`, preserving statuses, ownership, reviews and edition selection. A genuinely external title requires a verified source ISBN or an exact external search result and uses the existing ISBN-locked creation RPC; display artwork, guessed publication years and collection metadata are not written to editions. Titles without a verifiable edition report a useful error instead of creating a speculative book. No migration, seed, background catalogue import or owner-data edit was executed during this refinement.

Production read-only checks confirmed that collection/path tables and `save_reading_path` are still absent. Existing authenticated Library INSERT/SELECT privileges, the unique canonical book constraint and the owner/user RLS policy support the explicit Wishlist action. The pending migration and seed remain unchanged and require separate approval.

Refinement validation: **395 unit/integration tests passed, 0 failed**, including real PostgreSQL conflict preservation, co-author identity matching and owner/other/anonymous RLS checks. **239 browser tests passed, 0 failed, 1 intentional skip** across Chromium and iPhone WebKit. Build and runtime checks passed (69 modules). PWA generation is **121**. Focused mobile checks include 320/390/430 widths, simulated notch/home-indicator insets, both themes, native shelf scrolling, a Chromium touch swipe, centred small shelves, canonical Wishlist additions, simulated concurrent Read/cover preservation, menu access and bottom-navigation clearance.

`node scripts/verify-collections-ui.mjs` verifies all 36 image responses and captures both themes in both mobile engines with an isolated HTTP backend. Set `READING_ROOM_PREVIEW_URL=https://bojango.github.io/Librariangpt/` to repeat against deployed assets. The deployed bundle is read from Pages and only its Supabase origin is redirected to fixtures; these checks never authenticate or write to production. Genuine-owner UI review still requires sign-in. Evidence and screenshots stay in ignored `output/collections/`.

Deployment uses the existing manually dispatched Pages workflow on `feat/collections-reading-paths`, temporarily replacing the shared frontend. Main remains `2bb5c7e1fd991748dcf10386d9f6ddea68f429a8`. Immediate rollback: `gh workflow run deploy-pages.yml --repo bojango/Librariangpt --ref main`. No merge is required.
