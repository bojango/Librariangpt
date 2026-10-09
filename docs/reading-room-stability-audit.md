# Reading Room stability audit — 9 October 2026

Changes are prepared on `fix/reading-room-stability-audit`, based on main `3cbabc1`. Existing feature branches, including NFC and reading check-in work, were preserved. The initial audit below was read-only. **Release update:** the separately approved security permission hotfix was deployed and verified as migration `20261009202447`; no production reading rows or storage objects were changed. The wider stability migration/application release remains pending staging and production approval. See the [release continuation and recovery procedure](reading-room-release-runbook.md) and [migration reconciliation](reading-room-migration-reconciliation.json) for current status.

## Original bugs and fixes

| Bug | Verified root cause | Prepared fix |
| --- | --- | --- |
| A — custom cover silently fails | Both upload paths rejected a missing edition. `saveCustomCover` returned an asynchronous upload promise without awaiting it inside its catch. Diagnostic session 6NVNDL contains four matching unhandled rejections. Yeti has no editions. The old Edge handler required an edition and ignored some persistence errors. | Accept a null edition and save the book cover transactionally, while still validating and updating an edition when provided. Await uploads, show processing/uploading/success/failure feedback, and restore controls on failure. Validate supported image bytes and the live 5 MB storage limit. Immutable storage paths prevent replacement images from being served from an old cache. Protect locked book covers and make the library view display the locked book cover before an automatically enriched edition cover. |
| B — swipe leaves scrolling locked | Settlement depended on `transitionend`. Interrupted transitions and route replacement could leave gesture state and a translated container behind. Events from child transitions could also settle the wrong animation. | Track the actual container, clean up on navigation/suspension/cancellation/lifecycle exits, filter transition events, and use a bounded completion timer. Check route identity before navigating back. Preserve standalone edge swipe-back, vertical intent and native non-cancelable gestures; exclude interactive elements, horizontal shelves and edition lists. |
| C — Yeti has zero editions | The stored title includes the subtitle, while `subtitle` is null. Bare-title fallback depended on a separate subtitle. Live Open Library full-title search returned zero; “Yeti” plus Graham Hoyland found work OL21195450W and three editions. A live Google Books request returned 429. The browser could poll old state before discovery began. | Search ISBN, full title and bare title with independent title/author checks. Retry the bare title if initial results are unrelated. Await discovery before loading final catalogue state, ignore stale asynchronous modal updates, recover stale searches, and retain provider diagnostics/global Google backoff. A service-only, row-locked per-book claim and 60-second cooldown limit repeated requests. Distinguish no matches from temporary provider failure. Add source-backed manual creation with checksum/prefix validation, canonical ISBN alias deduplication, cross-book conflict rejection and unknown fields left null. Selection remains an explicit existing action. |

Provider normalization also prevents new contradictory ISBN-10/13 pairs and rejects incoming page totals outside 1–10,000. Contradictory canonical ISBNs cannot be merged merely because they share a provider ID. Unknown formats are no longer counted as confirmed print editions. Existing questionable metadata is not rewritten.

## Production audit and priorities

Project: `fbbpovieqfsjunmqtxvf`, matched against repository configuration; active/healthy PostgreSQL 17.6.1.166 in eu-west-1. Inspected table schemas, foreign keys, relationships, RLS policies, public views/functions, storage configuration and referenced objects, enrichment jobs, migration history, all 16 deployed Edge Functions, and retained diagnostic/provider logs.

Supporting evidence: [SQL queries](reading-room-audit-queries.sql), [integrity counts](reading-room-audit-evidence.json), [additional checks and affected ISBNs](reading-room-audit-details.json), [deployed code comparison](reading-room-deployed-comparison.json), [migration drift](reading-room-migration-drift.json).

| Priority | Evidence and impact | Proposed action / current state |
| --- | --- | --- |
| **P1 — unauthorized check-in writes (remediated)** | The initial audit found `record_reading_checkin_bridge(uuid,uuid,text,integer,integer,text)` SECURITY DEFINER with PUBLIC/authenticated execution and configured-owner event writes. | Separately approved migration **20261009202447** revoked PUBLIC/anon/authenticated execution, retaining service_role/postgres. Actual production denial probes return 42501. The deployed Edge bridge uses two different service-only RPCs; its snapshot still executes. Legitimate writes and deduplication pass isolated PostgreSQL tests. No production test events were written. See the release evidence. |
| **P2 — incompatible edition identity** | 11 editions have ISBN-10 and ISBN-13 values for different printings. None is identity-locked or exact-copy verified. Examples include Ready Player One, Children of Time and Jurassic Park; full affected IDs and values are in the evidence. | New enrichment avoids introducing conflicting aliases. Review each historical record against its physical copy or an authoritative catalogue; propose individual repairs for approval. Do not infer which ISBN is correct from checksum alone. |
| **P2 — implausible edition pages** | Jurassic Park edition `40edad7f-a953-475b-8955-c7aa36038c4e`, ISBN 9787551123181, has 12,549 pages from old Open Library enrichment. | New provider values are bounded. Historical value needs source verification and approved correction, including any affected progress calculation. No history was adjusted. |
| **P2 — stale edition searches** | Nine `refreshing` books have null/old refresh timestamps: Stuff Matters, The Seven Deaths of Evelyn Hardcastle, The Martian, The Unfinished Harauld Hughes, Sand, Solaris, The Lost City of Z, Sphere and Delta-v. | UI recovery and timestamped discovery claims are prepared. Retry individually after deployment; do not bulk-reset status or generate excess provider calls. |
| **P2 — deployment/migration drift** | 16 live migration versions are absent from repository filenames; 11 pre-existing repository versions are absent from live history. Some names overlap under different timestamps. The new migration is also unapplied. 15 of 16 deployed function bundles match main; deployed `book-metadata` v6 lacks main’s fiction/nonfiction handling. | Reconcile SQL bodies and history deliberately before deploying; do not replay every “missing” migration or automatically repair the migration table. Review the metadata deployment discrepancy separately. |
| **P2 — residual outbound-image risk** | `select-cover` fetched arbitrary stored URLs without a size/time bound. New checks reject private IP literals/local hostnames and unsafe redirects, stream at most 5 MB, and time out after 12 seconds. DNS resolution/rebinding is not pinned. | Owner authentication limits access, but hostname validation alone is not complete SSRF protection. A deployment-level egress policy or validated proxy remains advisable. This limitation is not represented as solved. |
| **P3 — authentication configuration** | Security advisor reports leaked-password protection disabled. | Review enabling it in Supabase Auth; no configuration changed. |
| **P3 — missing FK indexes** | Performance advisor reports missing indexes on `book_quotes.book_id` and `edition_id`. | Two indexes prepared in the migration. Other “unused index” warnings are informational; no indexes were dropped. |

The executed anti-joins checked **72 foreign keys**, all with zero orphan rows. Additional checks found zero cross-book edition/reference/quote/cover links, ownership mismatches in linked progress/feedback/notes/NFC/diagnostics, invalid progress bounds, reversed reading dates, negative or >24-hour finished NFC durations, incomplete submitted NFC sessions, duplicate open NFC sessions, duplicate active recommendations, duplicate library entries, duplicate Up Next books/positions, locked books without a cover, uploaded editions without a lock, multiple selected covers, or missing referenced stored book-cover objects.

All inspected public tables have RLS enabled; all 11 public views use security-invoker behavior. Reviewed 48 public/storage policies. The owner guard compares `auth.uid()` with private owner configuration. Service-only internal tables intentionally have no client policy. Public book covers have a 5 MB JPEG/PNG/WebP limit; avatars are private with owner-folder policies. Public cover access is intentional, so uploads should contain only intended cover artwork.

The enrichment queue has 20 completed and nine retry jobs, with no stale processing or overdue queued jobs at audit time. Retry status alone is not a defect. Two paused books and two non-owned Wishlist/Recommended books in Up Next were investigated: planner eligibility explicitly includes all these statuses and models availability separately. They are valid, not repair targets.

Yeti was the one library entry without a cover and had `editions_status=failed`, zero editions, and stored Google rate-limit evidence. Retained Edge access logs include HTTP 200 edition requests; HTTP 200 is not proof of provider success. The filtered retained function-log query yielded no matching failure messages for the inspected window; this does not disprove the saved diagnostic evidence.

## Edition-source verification

The regression fixture preserves the actual [Open Library edition response](https://openlibrary.org/works/OL21195450W/editions.json?limit=50) captured on 9 October, rather than inventing provider metadata. It identifies ISBNs 9780008279516 (2018), 9780008279493 (2018) and 9780008279523 (2019). Unknown format/pages remain unknown in provider fixtures.

The manual browser regression uses the 2018 hardcover ISBN **9780008279493**, William Collins, 320 pages, corroborated by [Postscript’s edition listing](https://www.psbooks.co.uk/yeti) and Open Library. Catalogue page totals can differ: NHBS’s old listing says 310. A real physical-copy verification should resolve that difference before marking page count verified. ISBN **9780008279516 is an ebook**, confirmed by the publisher copyright text in [the licensed edition excerpt](https://www.litres.ru/book/graham-hoyland/yeti-63243120/chitat-onlayn/); its print format/page count is not inferred from the hardcover. No production Yeti edition was saved.

## Migration and deployment requirements

Review [20261009184736_reading_room_stability.sql](../supabase/migrations/20261009184736_reading_room_stability.sql) in a dedicated Supabase test project before any production application. It contains:

- Conditional revocation of the unsafe legacy check-in RPC was extracted to the separately deployed security migration `20261009202447`.
- Service-only transactional cover selection and a book-cover lock trigger.
- Library-view cover precedence/lock projection, preserving security-invoker settings and existing rating selection.
- Service-only edition-discovery claim.
- Authenticated, owner-checked manual edition creation with evidence and serialized ISBN alias checks.
- The two book-quote FK indexes.

The view rewrite intentionally aborts if its expected existing cover expression differs. PGlite executes the actual migration, now also against the captured production view; that is useful SQL validation, not a hosted Supabase staging deployment. Only the separately approved security permission migration has been applied in production. The stability migration, Edge deployments, bulk updates and historical data repairs remain unapplied. Deploy the stability migration before the handlers/frontend that depend on its RPCs. Changed handlers: upload-cover-photo, select-cover, edition-options and content-enrichment; shared edition utilities are bundled into their dependent functions.

## Verification and browser evidence

Final command results:

| Command | Result |
| --- | --- |
| `npm run build` | PASS — compiled application bundle and source map |
| `npm test` | PASS — 309 tests, zero failures/skips |
| `npm run check` | PASS — 56 modules |
| `npm run test:e2e` | PASS — 177 passed, one intentional desktop-only skip (mobile navigation test), zero failures; 1.4 minutes |

An intermediate run failed two browser cases because the new format select lacked a distinct accessible label. The label was corrected; the focused stability suite and final full run passed. Pre-existing test references were also corrected to the actual hardening migration filename, the current PWA generation and the existing 15-minute provider-backoff floor. The three original bugs each have automated regression coverage.

Regression coverage uses real Edge handler code with isolated storage/database/provider mocks, the captured Yeti provider fixture, PGlite SQL execution, and the compiled application in Playwright. SQL tests cover transactions, rollback, book locks/reference precedence, permission revocation, unauthorized callers, manual ISBN aliases/checksums/prefixes/cross-book conflicts, and repeated discovery claims. Motion tests cover missing transition events, interruption and repeated gestures. Browser tests cover book-only/edition cover replacement, invalid images, network failure, URLs, reload persistence, successful/failed discovery, manual creation/selection, rapid navigation, repeated/cancelled swipes and restored vertical scrolling. Existing reading progress, NFC and reading-time browser suites run alongside them.

Playwright runs Chromium and WebKit with touch-capable iPhone context, including **440 × 894** viewports. It records page errors and failed requests, checks unhandled promise rejections, translated-container cleanup, scroll position and horizontal overflow. The built-in browser was also used to inspect the isolated repository navigation fixture through Home → Library → Book → Back. Browser requests were mocked and external HTTPS requests blocked; real user data was never used as test write targets.

Windows WebKit intermittently reports cancelled/intercepted mocked REST requests as “Fetch API cannot load … due to access control checks” page errors during reload. These exact localhost mock messages are retained as test attachments and narrowly excluded from the error assertion; all other page errors and all application unhandled rejections fail. Intentional failed-upload requests are expected. The result is **not a claim of an error-free native iPhone run** or proof about production CORS.

Screenshots, reviewed after modal animations settled:

| Evidence | Chromium | WebKit / mobile |
| --- | --- | --- |
| Saved book-level cover after refresh | [Cover](evidence/reading-room-stability/cover-book-desktop.png) | [Cover](evidence/reading-room-stability/cover-book-iphone.png) |
| Catalogue usable through provider failure | [Edition catalogue](evidence/reading-room-stability/edition-desktop.png) | [Edition catalogue](evidence/reading-room-stability/edition-iphone.png) |
| Discovered edition selected after refresh | [Discovery](evidence/reading-room-stability/discovery-desktop.png) | [Discovery](evidence/reading-room-stability/discovery-iphone.png) |
| Scrolling after repeated navigation/swipes | [Library](evidence/reading-room-stability/navigation-desktop.png) | [Library](evidence/reading-room-stability/navigation-iphone.png) |

## Remaining validation

- Apply only approved changes to a dedicated Supabase environment and exercise real storage, REST/RLS, RPCs and deployed Edge handlers together.
- On a physical iPhone, test standalone PWA cold restart/service-worker update, app backgrounding during gestures, OS edge-back, pull-to-refresh, horizontal shelves, interrupted connectivity and camera/HEIC input. Desktop WebKit and synthetic touch events cannot establish native behavior.
- Browser persistence was verified with isolated persisted mock state and SQL persistence with PGlite. A native PWA restart against deployed Supabase remains unverified.
- External cover URL liveness was not exhaustively fetched. The storage-reference audit verifies existing object references, not every third-party image response or image’s visual correctness.
- Counts are a read-only snapshot, not a guarantee that every semantic metadata error or future security issue has been ruled out. Historical ISBN/page repairs, migration reconciliation, password configuration and DNS/egress hardening remain separate reviewed actions.
