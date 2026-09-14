# Reading Check-in bridge

`reading-checkin-bridge` is the restricted HTTP adapter for the external ChatGPT Reading Check-in automation. It exposes exactly two owner-fixed operations and no arbitrary SQL, table, RPC, user-selection, or administration surface. Supabase remains the canonical source.

## Operations

- Snapshot: `GET <SUPABASE_URL>/functions/v1/reading-checkin-bridge?action=snapshot&token=<READ_TOKEN>`. The function calls the service-only `reading_checkin_bridge_snapshot()`, which resolves `private.app_state.owner_user_id` and returns `reading_checkin_snapshot()`.
- Note (preferred): `POST <SUPABASE_URL>/functions/v1/reading-checkin-bridge` with JSON containing `action`, `token`, `note_text`, and optional `book_id`, `page`, `progress_percent`, `chapter_number`, and `chapter_title`.
- Note (automation compatibility): `GET <SUPABASE_URL>/functions/v1/reading-checkin-bridge?action=note&token=<WRITE_TOKEN>&book_id=<BOOK_ID>&page=<PAGE>&progress_percent=<PERCENT>&note=<URL_ENCODED_NOTE>`. This state-changing GET exists only because the scheduled automation may be limited to ordinary URL retrieval. Exact duplicates are no-ops, and unchanged rapid writes are throttled in the database.

The note path defaults an omitted `book_id` to the canonical snapshot current book. A supplied book must still belong to the configured owner, be Currently Reading, and have an active reading session. Canonical page/progress are preferred and materially stale inputs are rejected.

## Secrets and deployment

The function is intentionally deployed with `verify_jwt = false` and authenticates every supported action itself using independent, constant-time-compared secrets:

- `READING_BRIDGE_READ_TOKEN`
- `READING_BRIDGE_WRITE_TOKEN`

Generate each value independently with at least 32 bytes of cryptographic randomness. Never commit them or a token-bearing URL. Set or rotate both with:

```sh
supabase secrets set --project-ref <PROJECT_REF> READING_BRIDGE_READ_TOKEN=<NEW_READ_TOKEN> READING_BRIDGE_WRITE_TOKEN=<NEW_WRITE_TOKEN>
supabase functions deploy reading-checkin-bridge --project-ref <PROJECT_REF> --no-verify-jwt
```

After rotation, update the external automation promptly; old token-bearing URLs must be treated as credentials. Do not use the project service-role key outside the Edge Function environment.

## Security and failures

Read and write tokens are not interchangeable. The read token can return only the canonical snapshot; the write token can call only the validated note path. The database RPCs are granted only to `service_role`, owner selection is server-side, response caching is disabled, browser credentialed CORS is not enabled, and errors never include database details or tokens.

Infrastructure failures return `503` with `{"ok":false,"error":"temporarily_unavailable"}`. The automation should remain silent and retry on its next scheduled run.
