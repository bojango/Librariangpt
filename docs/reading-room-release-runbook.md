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

The existing organisation is Free; its dashboard explicitly reports no scheduled project backups. Hosted branching requires Pro. No staging project/branch has been provisioned, and no plan or billable resources have been changed. Organisation/cost approval is pending. Docker is unavailable locally.

A current full logical database archive and role definitions without role passwords were exported using native `pg_dump` 17.11, temporary CLI login credentials held only in process memory, and `verify-full` TLS with the dashboard-provided Supabase CA. The archive decoded completely with `pg_restore`; it includes Auth users, storage metadata, private configuration and all application table data. [Backup evidence and hashes](evidence/reading-room-release/database-backup.json) contain no data/credentials. Private backup files are under ignored `output/`, never committed or published. An actual hosted restore has not yet been executed, so project-level recovery is not claimed fully validated. Stored media bytes and external platform configuration/secrets require their separate recovery sources; this release must preserve existing storage objects. Hosted integration and restore validation still gate the wider release.

## Safe deployment sequence

1. Security hotfix: **already applied and verified**. Never restore its former public privileges.
2. Provision an isolated Supabase staging environment only after the organisation and exact cost are approved. Use generated/sanitised fixtures, not production reading records. Do not run production scheduler commands or copy capability tokens into staging.
3. Restore the current schema baseline without production schedules/secrets or reading data; configure a staging owner/test login and dedicated storage. Apply only the proposed stability migration. Deploy its four changed Edge bundles: `upload-cover-photo`, `select-cover`, `edition-options`, `content-enrichment`, including their shared files. Verify actual Auth/JWT, RPC/RLS, storage upload/replacement, manual locks, discovery/manual ISBN aliases, provider failures and existing NFC/check-in flows together.
4. Capture a current logical database backup, role definitions without role passwords, and current Edge bundle preimages. Record file hashes and restore validation. Keep private backups outside Git and public Pages artifacts. Database dumps do not include stored image bytes; preserve existing storage objects separately. This release uses immutable new cover paths and must not delete old objects.
5. Present the final, exact `20261009184736_reading_room_stability.sql` and staging results for the user's required production-schema approval. Re-run preflight immediately before application. Apply this one migration transactionally through Supabase; record the generated production version and align the repository filename to it. Stop on any unexpected object definition. Do not replay prior migrations.
6. Deploy the four validated Edge Functions with their existing JWT configuration, then verify hashes/versions and unauthorised rejection. Keep `book-metadata` deployment drift separate unless its classification change is explicitly included and validated.
7. Merge PR #22 only after all preceding gates pass. The existing `Deploy Reading Room to GitHub Pages` workflow runs on `main`, builds with Node 22 and publishes Pages. Wait for successful completion and verify the deployed commit, assets, service worker and cache generation agree (prepared generation 114).
8. Run deployed browser/backend smoke checks without production test/history mutations. Compare preserved reading/ownership/rating fingerprints, inspect errors and retries, and confirm the next natural check-in automation run. Physical iPhone testing remains required.

For repeat execution: inspect migration history **and** object definitions first. Skip an already-applied step only when its content/ACL/postconditions match. Abort on a partial or conflicting state; do not repair history speculatively.

## Recovery procedure

On failure, stop the release before merging/publishing more components. Record the failed step and error. A failed transactional migration must leave its previous objects intact; verify that before continuing. If Edge deployment fails, restore only the affected function from its saved deployed bundle, preserving JWT configuration and secrets. Revert/redeploy the previous frontend commit through Pages if necessary, and verify PWA assets/cache generation together.

Prefer leaving additive database RPCs/indexes in place when reverting the application. Do not drop new editions, cover candidates or uploaded objects: they may already contain legitimate user selections. Do not restore an old database over newer genuine reading activity. Any schema reversal or full database restore requires approval, a verified backup and an explicit plan for preserving activity after that backup. If a schema rollback is required before any new usage, review the captured old `v_library` and `verify_owned_edition` definitions, remove only the new cover trigger and restore those definitions in one approved transaction. Keep the security hotfix in all recovery paths.

## Issues outside this release

The 11 incompatible ISBN pairs require physical-copy or authoritative-catalogue evidence for each identity before an individual correction proposal. Jurassic Park's 12,549 pages require authoritative edition-specific evidence; do not guess the replacement or change progress/history. Nine stale searches should recover through bounded individual refreshes after release, not a bulk status rewrite. The two quote indexes are prepared. Leaked-password protection, outbound image DNS/egress hardening, remaining provider warnings and canonical bootstrap-history completion remain separate work.

## Final physical-iPhone checks

After confirmed production deployment, launch from the Home Screen and verify the updated version. Repeat Home → Library → Book → Back and Book → Wishlist → Home; interrupt edge swipes halfway, switch apps mid-swipe and check vertical scrolling, carousels and pull-to-refresh. On intended real book records, select a custom cover with and without an edition; confirm progress/success/error feedback, refresh, fully close/reopen the PWA and check the same cover remains. Discover Yeti editions or add only a source-verified legitimate copy, then confirm identity/cover persist. During the next genuine reading session, check NFC start/end/page submission and time/progress statistics; do not create artificial history. Confirm the next normal check-in arrives and matches the current book/page.
