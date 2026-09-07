# LibrarianGPT

A private, single-user personal library and reading tracker backed by Supabase.

## Architecture

- Static HTML/CSS/JavaScript frontend, suitable for GitHub Pages.
- Supabase Auth for sign-in.
- Supabase PostgreSQL is the canonical library database.
- Row Level Security restricts data to the claimed owner.
- Reading actions use database RPC functions so start/finish timestamps and progress logs are server-side.
- Installable PWA for iPhone/iPad/desktop.

## First deployment

1. Publish this repository with GitHub Pages from the repository root on `main`.
2. Open the deployed site and create the single owner account.
3. If Supabase asks for email confirmation, confirm the address and sign in.
4. Enter the one-time library claim code supplied separately during migration.
5. Once claimed, the code is invalidated in the database.
6. On iPhone, open the site in Safari, Share → Add to Home Screen.

## Supabase configuration

Public client configuration lives in `supabase-config.js`. The value is a Supabase **publishable key**, which is intended for client-side use. Database access is protected by Supabase Auth and RLS. Never add secret/service-role keys to this repository.

## App features

- Home shelves: currently reading, owned/unread, recommendations, wishlist, recently read.
- Library search and filters.
- Book detail pages.
- Start/resume reading.
- Page progress updates with automatic progress-log entries.
- Automatic started/finished timestamps.
- Pause and DNF actions.
- Basic reading stats.
- PWA manifest, service worker, and iOS home-screen support.

## Files

- `index.html`: app shell
- `styles.css`: responsive Plex-like library UI
- `app.js`: Supabase auth/data/actions and UI rendering
- `supabase-config.js`: public Supabase URL + publishable key
- `manifest.webmanifest`: PWA manifest
- `sw.js`: app-shell cache/service worker
- `icons/`: PWA icons

## Development

Because ES modules and service workers require HTTP, use a local web server rather than opening `index.html` directly. Example:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`.
