# Contextual next-read planning

Implemented on `feat/next-read-planning-up-next`, based on `70e6ba4` (the merged Liquid Glass work). Supabase project `fbbpovieqfsjunmqtxvf` is canonical. No Google Sheet, schedule, or existing Reading Check-in automation was changed.

## Audit and reconciliation

The audit covered the deployed tables, constraints, triggers, queue and reading RPC definitions, recommendation views, homepage, manager, ownership editor, bridge and tests before implementation.

- The live queue contained three unlocked AI choices: The Call of the Weird, Sphere and Feral. The homepage already displayed five and the manager already accepted reserves.
- The repository's `20260912120000_replenish_up_next_reserve.sql` was **not deployed**. Live `remove_started_book_from_up_next` removed a started book but did not replenish. The new migration supersedes both variants and does not apply the old migration to production.
- Live Reading Check-in snapshot, event and audit functions have additions absent from repository migration history. Those functions and the existing bridge were left intact. Do not blindly replay all historical migrations or treat this repository as a clean bootstrap: its original claim migration is deliberately redacted.
- `library_entries.ownership_status` already permits **On Order**, exactly as the frontend assumes. It is not an `overall_status`. No status conversion or second order concept was needed. The existing On order shelf is retained.
- Revelation Space's historical `purchase_ordered` event does not contradict its current **Owned** state. Current ownership wins; history is supporting evidence. No reliable metadata was rewritten.
- Progress is session-scoped with library/edition fallbacks. At verification Prey was at 271/364 pages (74.5%); The Unfinished Harauld Hughes was also open at 45.1%. Planning exposes all relevant sessions rather than assuming only one current book.
- Recommendation history includes acquired/inactive records; the planner can read their compatibility assessment without activating, deleting or rewriting them. Candidates must already belong to the library. Discovery-only recommendations remain in Recommendations until added to the library/wishlist.
- Taste Profile and Reading Feedback primarily contain prose. The deterministic planner matches known metadata labels against profile dimensions and strong generalisable feedback aspects; it does **not** infer sentiment from prose keywords. Existing recommendation assessments supply the broader compatibility estimate. The snapshot includes the prose for a later ChatGPT check-in.

## Schema

| Addition | Purpose |
| --- | --- |
| `next_read_intents` | One active intent per owner, session/book source, fiction/nonfiction leaning, preferred/avoided genre and style labels, preferred maximum pages, shorter/change-of-pace flags, desired/deferred book IDs, context, confidence, source, idempotency key, historical state/expiry reason and timestamps. |
| `next_read_transitions` | Session-keyed `asked`, `captured` or `skipped` acknowledgement. Persists after intent replacement/expiry. |
| `up_next_planner_state` | Coalesced dirty reasons, last meaningful change and last refresh. |
| `up_next_refreshes` | Append-only-through-RPC before/after queue snapshots, candidate evidence, reason and algorithm version. Includes manual edit history. |
| `up_next_exclusions` | A manual removal stays removed across refreshes. Explicit re-add clears it. |
| `library_entries.expected_available_on` | Optional explicit arrival date. No invented delivery dates. |
| `up_next_queue.ranking_details` | Inspectable candidate inputs and rule outcomes; not displayed as raw scores. |
| `up_next_queue.ai_score` | Persisted contextual **Next Fit** out of 10. It is separate from Recommendation `match_score_10` and cannot move a locked book. |
| Deferred unique `(user_id, position)` queue constraint | Complements existing unique `(user_id, book_id)` and permits atomic reorders. |

New tables have RLS and owner-only authenticated reads. Writes go through validated RPCs; API roles cannot directly mutate planner history or the queue. Existing queue RPC signatures remain compatible. New public RPCs are security invokers. The narrow private dispatchers are security definers with an empty search path, explicit owner authorization and restricted execution grants. Other private helpers are not API-executable. The trusted service-role path resolves the configured owner internally and accepts no arbitrary user ID.

Intent replacement closes the old record rather than overwriting it. Starting a new substantive reading session/book closes the previous intent with `next_book_started`; resuming a paused session does not. Finishing, DNF or pausing the source book prompts re-evaluation but preserves the upcoming-transition appetite until the next start or explicit expiry. Explicit `expire_next_read_intent` handles abandoned transitions. Saving an old request key returns the historical result and cannot resurrect expired intent. Invalid replacement requests roll back atomically.

## Ranking and queue behaviour

`context-v2` uses ordered rules and structural availability limits, not a single total score:

1. Exclude current reads, Read, DNF, Not Interested, dismissed recommendations and manual exclusions. Unknown eligibility is not silently accepted. A lock does not bypass these exclusions.
2. Preserve eligible locked books at their actual numbered positions. A manual reorder locks the positions it changes. Unlocked manual selections retain a soon signal. More than eight locks are retained; sparse libraries can yield fewer than eight candidates.
3. Partition automatic candidates into appetite matches, neutral/unknown, conflicting and explicitly deferred. Within a tier, compare appetite matches, then explicit desired/manual/high-priority signals. Desired + deferred is meaningful: still wanted, but later.
4. Compare compatibility bands: recommendation estimate divided into two-point bands, with a bounded adjustment from exact structured Taste Profile/strong generalisable Feedback matches. Missing recommendation evidence is neutral. This leaves room for context within broadly similar compatibility.
5. Prefer recent-reading contrast, then ownership/availability. Compare against the source session and up to three recent sessions. Recognise slash-separated genre labels and the Science Fiction family, including Hard Science Fiction and SF/sci-fi labels.
6. Fill the eight-book queue with normally at least **six available** books; at least **four of the first five** should be available. This is a selection rule rather than a tiny score bonus. An unowned book can exceed a limit only when its appetite and compatibility evidence are exceptional, or available candidates run out. Locks retain their positions even when they override normal composition.
7. A reliable On Order arrival before the current session's estimated finish counts as effectively available. Unknown arrival does not. The first automatic slot requires available ownership or reliable arrival when a viable option exists; a locked choice or explicit exceptional immediate choice can override it.
8. Use On Order and acquisition recency as supporting signals, then exact recommendation strength and wildcard value, with previous order and book ID as stable tie-breakers.

The target is eight selected books, five visible. Selection fills unoccupied positions around locks; reserve candidates can promote or be replaced without duplicate books. Absolute locks can leave non-contiguous positions when the eligible pool is small. Recommendations are never changed by a planner refresh. Manual history and the complete pre-refresh queue are retained in the audit table.

On Order is eligible even with unknown arrival. A known arrival before the source session's estimated finish improves availability evidence. That estimate requires at least two recent progress samples with positive progress; it is explicitly an estimate and never promoted to reliable book metadata. An arrival estimate is still weaker than present ownership.

Acquisition evidence comes from receipt/acquisition events and actual `ownership_changed` events. Its signal is at most 1, falls linearly to 0 over 45 days, and is compared only after appetite, personal priority, compatibility, contrast and availability. `added_at`/`updated_at` are not treated as purchase dates. Existing ownership editors now record actual ownership transitions once; ordinary metadata changes do not renew purchase recency. Older ownership records with no trustworthy event get no invented recency.

The planner also calculates an inspectable Next Fit out of 10 from current appetite, taste/feedback signals, contrast, length, availability, explicit intent and modest acquisition/recommendation evidence. The rules above determine the actual order; this score explains present suitability and is **not** the Recommendation match score. AI and locked rows receive the score on refresh, while locks keep their position. The queue view already exposes it.

Reasons use the current title, each candidate's recorded genre/subject tags, temporary appetite, relative length, explicit interest and supported taste/feedback signals where present. They do not repeat page counts, ownership labels, scores or public ratings. The homepage and detail modal show those as compact icon metadata: pages where known, ownership state, Next Fit and the canonical public rating where available. The rating provider is named in the modal and tooltip; Goodreads is shown only when `public_rating_provider` is Goodreads. No external rating fetch was added. Free-text intent and nuanced intensity preferences remain explanatory context unless represented by matching book/style tags; there is no semantic model hidden in SQL.

## Re-evaluation

| Change | Behaviour |
| --- | --- |
| Save/replace/expire intent | Refresh in the same transaction. |
| Reading status change, including finish/DNF/pause/start | Reconsider immediately; remove ineligible entries and fill reserves. New starts close previous intent. |
| Ownership/wishlist/priority/known length/arrival change; order/receipt event | Mark dirty. Existing editors record ownership transitions. |
| Meaningful Taste Profile or moderate/strong Feedback change | Mark dirty. Timestamp-only writes do not. |
| New recommendation scoring at least 8.5, or explicit high interest | Mark dirty; ordinary lower-score inserts do not force a refresh. Recommendation updates/deletes also invalidate. |
| Manual add/lock/reorder | Serialize and audit, then mark dirty; the subsequent app snapshot refreshes. Remove also refills immediately and records an exclusion. |
| Small progress changes | No queue refresh. Snapshot eligibility becomes true at 75%; saving captured intent refreshes. |
| App snapshot | `refresh_up_next('library_snapshot', false)` before queue read. Dirty changes coalesce. A once-daily refresh on access also ages purchase signals. |

There is no new scheduler. An external writer can explicitly refresh after a batch of meaningful changes. Metadata label changes become visible on the next explicit/daily refresh; routine enrichment is not an automatic reshuffle trigger. Advisory transaction locks serialize intent, queue and availability RPCs. Queue write privileges are narrowed to prevent authenticated direct writes bypassing that contract.

## RPC contract for the later ChatGPT automation

All RPCs support the authenticated owner or the trusted server-side service role; anonymous access is denied. The project service key stays inside the backend. A ChatGPT automation must use an authorized connector or a restricted server adapter, never embed a service key in its prompt or URL.

| RPC | Arguments | Result/use |
| --- | --- | --- |
| `next_read_planning_snapshot()` | None | Current/recent session transitions, progress, `should_capture_intent`, acknowledgement, active intent, eight-item queue, candidate reasoning, dirty state, profile and feedback. Read-only. |
| `save_next_read_intent(p_session_id, p_intent, p_request_key)` | Session UUID (nullable for a general explicit appetite), structured object, stable unique text key | Validates source/ownership, expires prior intent, captures transition and refreshes atomically. Returns intent ID/state, duplicate flag and refresh result. |
| `acknowledge_next_read_transition(p_session_id, p_status)` | Session UUID; `asked` or `skipped` | Atomic prompt claim: only the first call returns `acknowledged: true`. Later calls return false, including already captured transitions. |
| `refresh_up_next(p_reason, p_force)` | Defaults `explicit_refresh`, `true` | Force reconsideration, or use false to coalesce dirty/daily refreshes. Returns refreshed flag and queue count, plus audit ID when refreshed. |
| `expire_next_read_intent(p_reason)` | Required short explanation | Closes active intent and refreshes. |
| `set_book_availability(p_book_id, p_ownership_status, p_expected_available_on)` | Library book UUID, existing canonical ownership value, optional date | Records ownership/arrival and marks dirty. Use after a confirmed order/receipt. |

Suggested check-in sequence:

1. Call `next_read_planning_snapshot()`. Pick the relevant latest session and check `should_capture_intent`. Do not assume the first current book is the only open book. At 75–80%, inspect the saved transition/intent before asking.
2. If enough context is already known, save inferred/explicit intent directly. Otherwise call `acknowledge_next_read_transition(session_id, 'asked')`; ask only if it returns true. A deliberate skip uses `skipped`. Do not repeatedly ask after acknowledgement.
3. Call `save_next_read_intent` using the source session ID and a stable key such as `next-read:<session-id>:<capture-id>`. Reuse the **same key and exact payload** on a retry. Use a new key when the user intentionally changes appetite. Saving already refreshes, so an extra refresh call is unnecessary.
4. Read the snapshot again only if the automation needs the resulting order/reasons for its response. After other meaningful changes, call `refresh_up_next(reason, true)`.
5. Do not write temporary appetite into `reading_feedback`, `taste_profile`, or `taste_evidence`. Permanent interpretation requires separate evidence and a separate later decision.

Example payload (UUIDs must come from the snapshot):

```json
{
  "p_session_id": "<source-session-uuid>",
  "p_request_key": "next-read:<source-session-uuid>:<capture-id>",
  "p_intent": {
    "preferred_genres": ["Nonfiction"],
    "avoided_genres": ["Science Fiction"],
    "prefer_shorter": true,
    "change_of_pace": true,
    "desired_book_ids": ["<still-desired-book-uuid>"],
    "context": "Still want this book, but prefer a shorter nonfiction or non-SF read immediately.",
    "confidence": "High",
    "source": "reading_checkin"
  }
}
```

Other accepted keys are `fiction_nonfiction` (`Fiction`/`Nonfiction`), `preferred_max_pages` (1–10000), `desired_styles`, `avoided_styles`, and `deferred_book_ids`. Labels are case-insensitive and must correspond to available metadata. Arrays are limited to 50 entries; context to 4000 characters; confidence is Low/Medium/High. Unknown keys and books outside the owner's library are rejected. Generic free text alone is stored but not converted into structured ranking constraints.

The existing `reading-checkin-bridge` still exposes only snapshot/note/health. **Later integration work is required** to add an explicit allowlist of planner read/write actions (or configure an authorized connector) and update the automation instructions. Do not forward arbitrary RPC names. That adapter and the automation were intentionally not modified in this task. These RPCs are ready for it now.

## Live result and verification

Applied migrations on 2026-09-29:

- `20260929115125_contextual_next_read_planner`
- `20260929120108_harden_next_read_transition_claim`
- `20260929172145_strengthen_next_read_queue`
- `20260929172447_specific_next_read_reasons`
- `20260929172647_precise_next_read_evidence`

Migration files were generated by the CLI and aligned to the versions assigned by the live migration API. Historical drift elsewhere was not rewritten.

The supplied Prey appetite was saved as user-supplied temporary intent, with the actual session/book IDs and no invented maximum-page requirement. Its transition is captured. The final live queue has eight books: Black Holes, The Last Season, The Call of the Weird, Feral, How to Design a Universe, The Wild Places, Roadside Picnic and Project Hail Mary. Six are owned and available, including four of the visible first five; the two unowned candidates remain because of contextual fit. Black Holes is first with Next Fit 8.6/10. Each AI row has a persisted score and subject-specific reason. Revelation Space remains owned, explicitly desired and inspectable in the broader candidate pool, with immediate appetite conflicts. It need not occupy one of the eight selected slots during this transition. The queue refresh does not change Recommendation, Taste Profile or Feedback history.

Validation includes actual PostgreSQL execution using pinned PGlite in `npm test`, rather than a duplicated JavaScript ranker; frontend five/eight rendering tests; focused desktop/mobile E2E metadata checks; and `tests/sql/next-read-planner-live.sql`, an authenticated-owner live acceptance transaction that rolls back all its mutations. The latter verifies the real scenario, composition, scores, locks, On Order/receipt, start/expiry and unchanged recommendation/taste/feedback history. The test-only bootstrap reuses repository schema migrations and replaces only deployment-specific auth/claim setup.

Final validation: build and runtime architecture check passed; 206 unit/database tests passed; 103 E2E tests passed with one existing project-specific skip, including desktop and mobile metadata/modal checks. The first full E2E attempt exposed an outdated score selector and one browser resource error at eight workers; the selector was updated and the complete suite passed at four workers. Older cache-generation and pre-merge glass assertions were reconciled to the already-merged UI. Shell generation advances to 103 so installed clients receive the frontend change when this branch is deployed.

Security advisors reported no new planner findings. Existing findings remain: [anonymous execute on the older record-reading-check-in bridge](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), authenticated execution on existing definer RPCs, service-only tables with no user RLS policy, and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Performance advisors reported existing unindexed `book_quotes` foreign keys and informational unused indexes, including newly installed planner indexes. Those access/security settings were not changed as part of this queue feature.

## Rollback and remaining limits

`supabase/rollback/contextual_next_read_planner.sql` restores the audited pre-feature queue functions, detaches invalidation triggers, disables new API entrypoints and restores original authenticated queue write grants. It retains intent/audit data and the current queue, rather than discarding history. Deploy the previous frontend with it. A deliberate data-order restoration can use the earliest `up_next_refreshes.before_queue`; do not replay it over later manual choices blindly.

This is a deterministic metadata-based planner, not semantic understanding of every review. Sparse/unknown metadata is kept explicit, and titles or current-example IDs are never embedded in production ranking logic. Arrival estimates can be uncertain; tags and compatibility assessments still benefit from later check-in interpretation. Manual exclusions persist until re-add, and absolute locks take precedence over the eight-book target. No new periodic task was created, and no code was merged into main.
