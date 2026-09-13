# Reading Room

Reading Room is a private personal-library and reading-tracking PWA backed by Supabase.

## Architecture

The browser runtime is deliberately small and framework-free:

```text
Supabase
  -> src/data (one client, repositories, in-flight request dedupe)
  -> src/state.js (authoritative loaded UI state)
  -> src/router.js (GitHub Pages-safe hash routes)
  -> src/views (single-pass route markup)
  -> src/features (explicit actions and modal workflows)
```

`index.html` loads one stylesheet and one bundled ES module. Feature markup is rendered into explicit route layouts; there are no MutationObservers, forced reloads, or global Supabase-response caches in the production runtime.

Supabase remains canonical for books, editions, collection state, reading sessions, progress, ratings, recommendations, quotes, and queue state. Static assets and covers are the only application-managed persistent caches.

## Development

Requires Node.js 22 or later.

```bash
npm ci
npm run build
npm test
npm run check
npm run test:e2e
```

The E2E suite uses Chromium and WebKit. Install their local binaries once if needed:

```bash
npx playwright install chromium webkit
```

For manual development:

```bash
node scripts/serve.mjs
```

Then open <http://127.0.0.1:4173>.

## Deployment

1. Run `npm ci && npm run build`.
2. Apply any new migrations in `supabase/migrations/` and deploy only Edge Functions changed by the release.
3. Commit `dist/app.js` and `dist/app.js.map`.
4. Publish the repository root with GitHub Pages.

The service worker uses a versioned application-shell cache, network-first navigation, release-bounded cover caches, and never caches canonical Supabase API responses.

## Supabase source control

Current deployed database migration statements and all current deployed Edge Function sources were exported read-only into `supabase/`. Deployment metadata beside each function records the deployed version, JWT setting, and checksum. Secrets are referenced only through runtime environment variables.

Review `supabase/README.md` before any backend deployment. Never place service-role keys or provider secrets in this repository.

### Reading Check-in automation handoff

The external hourly ChatGPT Reading Check-in automation remains the scheduler. It should call `reading_checkin_snapshot()`, detect meaningful real progress, and optionally persist one brief card comment through `save_reading_card_note()`. It should use `latest_card_note` to avoid repetition, never invent unread plot events, and stay silent unless an independent conversational check-in is warranted. Notes should ideally be one sentence (occasionally two short sentences), prefer roughly 240 characters or fewer, contain no spoilers, and discuss story events only when supported by feedback, chapter data, or stored reading context; otherwise they should stick to progress, pace, reading stage, and known reactions.

## Security

The browser contains only the public Supabase project URL and publishable key. Access is enforced by Supabase Auth and RLS. A final read-only advisor audit found outstanding remote configuration findings documented in `REFACTOR_STATUS.md`; this branch intentionally does not mutate production schema or Auth settings.
