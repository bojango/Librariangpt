# Reading Room release continuation — 9 October 2026

PR: https://github.com/bojango/Librariangpt/pull/22. Branch: `fix/reading-room-stability-audit`. Production project: `fbbpovieqfsjunmqtxvf`.

## Completed security deployment

The user approved the exact permission-only SQL on 9 October. Supabase applied `secure_reading_checkin_bridge` as version **20261009202447** at 20:24:47 UTC. The repository file was aligned to that generated version without changing production history or the reviewed SQL.

`record_reading_checkin_bridge(uuid,uuid,text,integer,integer,text)` now has only `{postgres=X/postgres,service_role=X/postgres}`. Actual production calls as both `anon` and `authenticated` fail with SQLSTATE **42501**. The function body MD5 remains `5f41baef80645072f955cee90ab7dbdc`.

Caller review found no references in application/Edge source, database routines, catalog dependents, cron commands, or the installed local Codex automation. The deployed `reading-checkin-bridge` v8 uses `reading_checkin_bridge_snapshot()` and `save_reading_card_note_bridge(...)`, both already service-only. The 64 observed direct legacy calls all used `postgres`, whose access remains. External ChatGPT automation configuration was not directly accessible; its observed SQL execution role remains allowed. No automation was disabled or credentials rotated.

The actual service-role snapshot RPC executed successfully in production. Isolated PostgreSQL tests execute the deployed legacy writer and the repository's legitimate snapshot/note RPCs: untrusted callers are denied after the hotfix, service and database-owner writes work, a legitimate service bridge note saves, duplicate check-ins remain deduplicated, and progress stays unchanged. No production check-in, note, reading or test rows were written.

The post-hotfix log window, 20:24:47–20:31:55 UTC, contains exactly two PostgreSQL ERROR entries, both SQLSTATE 42501 from the deliberate denial probes, and two `/functions/v1/book-background-enrich` responses with HTTP 202. This short window does not establish long-term automation health.

Evidence: [security-hotfix.json](evidence/reading-room-release/security-hotfix.json).

## Migration reconciliation

Compared full production migration statements, current routine definitions and the live library view, rather than timestamps alone. [The reconciliation manifest](reading-room-migration-reconciliation.json) records nine SQL-equivalent timestamp pairs. Do **not** apply either side again.

The old Up Next reserve migration is superseded by the contextual planner: live `private.replenish_up_next` delegates to `private.refresh_next_read`, and the status trigger maintains planner intents. The skipped historical Goodreads migration was replaced by `20260914193119_complete_goodreads_weekly_refresh`; its table, indexes, RLS and RPCs exist, with newer enrichment-health selection already deployed. Replaying either historical script would regress behavior or fail.

Seven live-only historical versions concern check-in reads, recent completion, the legacy event writer, run auditing and the combined audit/snapshot RPC. Their objects already exist in production. They are repository bootstrap drift, not missing production prerequisites. Preserve them and their current restricted ACLs. The repository is not yet a complete canonical clean-install history; do not use blind `db push --include-all`, migration-history repair or a timestamp-only replay to deploy this release.

Live preflight confirms all three new stability RPCs, the book-cover trigger and both quote indexes are absent, while the live `v_library` matches the migration's guarded expression. The current `verify_owned_edition` matches its repository baseline. Isolated PostgreSQL tests now use the **actual production view definition**, preserving the Goodreads selection and column order while applying the proposed cover change.

PR review correction: explicit verification of a different physical edition is a manual cover selection. The amended RPC sets the transaction-local override and copies the selected cover's source/verification fields, so the new lock trigger does not silently retain the previous cover. A regression switches away from a locked custom cover, then confirms enrichment cannot overwrite the newly selected cover.

## Validation and release gates

Executed after the correction: build passed; **310 unit/integration tests passed**; runtime check passed for 56 modules; full Playwright suite **177 passed, 1 intentional desktop-only skip**. Chromium and mobile touch WebKit use isolated mocked Supabase data at 440 × 894. SQL executes in PGlite. These are not hosted Supabase integration tests. Existing NFC, reading progress/time and check-in tests pass.

The user authorised controlled production deployment without staging on 9 October. No extra projects, Docker, plan changes or paid infrastructure were introduced. The reviewed stability SQL remained byte-equivalent after line-ending normalisation (SHA-256 8bde336edaada2d6e9940e3465e90cb3f7b271e88a8bce1744647252553bca5a).

A fresh full logical archive, password-free role definitions and four deployed Edge bundle preimages are stored privately outside the repository. All 84 table-data sections are present and the complete archive decodes successfully. TLS certificate verification remained enabled. The original archive was preserved. No genuine reading activity occurred after the original backup; a fresh backup captured subsequent backend state anyway. A hosted restore was not performed. Stored media bytes and external platform settings/secrets are separate recovery sources; existing images are preserved. [Fresh backup evidence](evidence/reading-room-release/fresh-database-backup.json).

## Production backend deployment — completed

Supabase applied the unchanged stability migration transactionally as **20261009212029**. The original reviewed filename stays unchanged; the reconciliation manifest maps it to the generated production version without rewriting history. The three RPCs, enabled cover-protection trigger, valid quote indexes and 69-column invoker library view are present. Goodreads view selection is preserved. The security hotfix body and restricted permissions remain unchanged.

All 12 captured genuine-data fingerprints stayed identical immediately after the migration and rollback-only live RPC tests. At 21:35 UTC, the normal scheduler independently enriched the real Yeti record, adding three editions, one public provider rating and two scheduler events. Existing rows in those three tables retain their original fingerprints, and the other nine table fingerprints remain identical. The real Yeti catalogue is now ready with three editions; no agent refresh request was sent for that genuine book. [Natural scheduler evidence](evidence/reading-room-release/natural-yeti-enrichment.json). These cover library ownership/progress/reviews, sessions, progress logs, time sessions, feedback, notes, recommendations, public ratings, library events, NFC bookmarks/pending starts and editions. The health audit found zero orphans across 72 foreign keys, zero relationship/progress errors, and only the previously identified implausible page-count record. Historical ISBN/page metadata was not rewritten.

Live transaction tests validated manual ISBN checksums/aliases, duplicate prevention, discovery leases, book covers, edition replacement, locked-view precedence, exact-copy verification and permission denial; all writes rolled back. Real storage upload/download bytes matched and its disposable image was removed.

The four updated functions are active, JWT verification unchanged, and downloaded source/dependencies match repository content: upload-cover-photo **v7**, select-cover **v7**, edition-options **v17**, content-enrichment **v19**. All unrelated function versions, scheduler credentials and check-in/NFC authentication configuration are preserved. Anonymous requests return 401, including the legacy check-in REST RPC with SQLSTATE 42501.

After explicit approval, the existing managed service credential was held only in process memory for integration validation. A disposable Auth user and Yeti book discovered three credible Open Library editions despite Google 429. Immediate refresh respected the 60-second lease; the next isolated probe skipped Google under its retained cooldown. Content enrichment returned 200/partial. Real storage plus REST/RPC book-only and edition cover replacement passed fresh-read persistence and manual-lock protection, including a subsequent content-enrichment call. All disposable users, books, candidate/edition rows and images were removed; no reading history was created. [Live integration evidence](evidence/reading-room-release/live-provider-smoke.json).

The initial test fixture used an invalid metadata status; production correctly rejected it and the fixture was corrected to the actual allowed status. CLI-issued legacy service keys were rejected by both changed and unchanged Edge handlers. The existing managed service credential succeeded through the supported apikey header; no authentication or credential configuration was changed.

Build passed; **310 unit/integration tests passed**, runtime checks passed for 56 modules, and Playwright passed **177 tests with one intentional skip**, including mobile WebKit at 440 × 894. [Backend postconditions](evidence/reading-room-release/production-backend.json). The existing browser session is signed out; authenticated owner UI smoke testing awaits sign-in. Physical standalone iPhone validation remains necessary.

## Remaining frontend deployment sequence

1. Complete final diff/security review and record production backend evidence on PR #22.
2. Merge PR #22 into main without deleting or overwriting feature branches.
3. Wait for the existing Pages workflow to complete for that exact merge commit. Verify live index/assets/service-worker generation 114 and fresh-cache behaviour.
4. Run accessible live browser/Playwright smoke tests, record the authenticated-session limitation if it remains, and recheck genuine-data fingerprints, health, permissions, function versions and logs.

For repeat execution: inspect migration history **and** object definitions first. Skip an already-applied step only when its content/ACL/postconditions match. Abort on a partial or conflicting state; do not repair history speculatively.

## Recovery procedure

On failure, stop the release before merging/publishing more components. Record the failed step and error. A failed transactional migration must leave its previous objects intact; verify that before continuing. If Edge deployment fails, restore only the affected function from its saved deployed bundle, preserving JWT configuration and secrets. Revert/redeploy the previous frontend commit through Pages if necessary, and verify PWA assets/cache generation together.

Prefer leaving additive database RPCs/indexes in place when reverting the application. Do not drop new editions, cover candidates or uploaded objects: they may already contain legitimate user selections. Do not restore an old database over newer genuine reading activity. Any schema reversal or full database restore requires approval, a verified backup and an explicit plan for preserving activity after that backup. If a schema rollback is required before any new usage, review the captured old `v_library` and `verify_owned_edition` definitions, remove only the new cover trigger and restore those definitions in one approved transaction. Keep the security hotfix in all recovery paths.

## Issues outside this release

The 11 incompatible ISBN pairs require physical-copy or authoritative-catalogue evidence for each identity before an individual correction proposal. Jurassic Park's 12,549 pages require authoritative edition-specific evidence; do not guess the replacement or change progress/history. Nine stale searches should recover through bounded individual refreshes after release, not a bulk status rewrite. The two quote indexes are prepared. Leaked-password protection, outbound image DNS/egress hardening, remaining provider warnings and canonical bootstrap-history completion remain separate work.

## Final physical-iPhone checks

After confirmed production deployment, launch from the Home Screen and verify the updated version. Repeat Home → Library → Book → Back and Book → Wishlist → Home; interrupt edge swipes halfway, switch apps mid-swipe and check vertical scrolling, carousels and pull-to-refresh. On intended real book records, select a custom cover with and without an edition; confirm progress/success/error feedback, refresh, fully close/reopen the PWA and check the same cover remains. Discover Yeti editions or add only a source-verified legitimate copy, then confirm identity/cover persist. During the next genuine reading session, check NFC start/end/page submission and time/progress statistics; do not create artificial history. Confirm the next normal check-in arrives and matches the current book/page.
