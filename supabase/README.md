# Supabase source snapshot

This directory was exported read-only from project `fbbpovieqfsjunmqtxvf` on 2026-09-09. No database data, schema, Auth settings, secrets, or deployed functions were changed during the export.

## Contents

- `migrations/`: all 34 entries currently present in `supabase_migrations.schema_migrations`, preserving deployed version order and statements.
- `functions/`: all 11 active deployed Edge Functions. Each directory contains the deployed source plus `deployed.json` with version, `verifyJwt`, and source checksum.

The functions are `book-metadata`, `cover-refresh`, `content-enrichment`, `cover-options`, `select-cover`, `chapter-map`, `edition-options`, `upload-cover-photo`, `book-search`, `book-background-enrich`, and `book-search-fallback`.

## Deployment safety

- Do not deploy this snapshot blindly. First compare the target project and test against a Supabase development branch.
- Never commit `.env` files, provider credentials, database passwords, secret keys, or service-role key values.
- The source uses `Deno.env.get(...)` for runtime configuration; no secret values were exported.
- `book-metadata` is currently deployed with gateway `verify_jwt` disabled, but its source validates the caller and owner internally. This setting was preserved, not endorsed or changed.
- All other exported functions currently have gateway JWT verification enabled.

## Read-only advisor findings

The remote project currently reports:

- Error: `public.v_library` is a security-definer view. Its current definition must be reviewed before a safe `security_invoker` migration is authored.
- Warning: authenticated users can execute the security-definer `public.admin_edit_book(...)` RPC. This may be intentional for the single-owner app, but its internal owner check and grants require review.
- Warning: leaked-password protection is disabled in Supabase Auth.
- Info: `book_quotes.book_id` and `book_quotes.edition_id` foreign keys lack covering indexes.

No remediation was applied to production because this refactor was explicitly constrained to non-destructive work and no isolated Supabase branch was provisioned.

## Diagnostic Test Mode migrations

On 2026-09-10 the additive migrations `20260910194645`, `20260910194728`, and `20260910194958` were deployed for the opt-in diagnostic recorder. They create only `public.diagnostic_sessions` and `public.diagnostic_events`, enable authenticated owner-only RLS, remove legacy default grants, and retain the unique `(session_id, sequence)` upload key. Post-deployment verification found zero diagnostic rows. Existing Library tables and data were not modified.
