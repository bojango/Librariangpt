-- Per-owner, theme-scoped UI preferences. Canonical CSS presets never live here.
create table if not exists public.reader_ui_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  selected_theme text not null default 'reading-room' check (selected_theme in ('reading-room', 'terminal')),
  appearance_overrides jsonb not null default '{}'::jsonb,
  copy_overrides jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reader_ui_preferences enable row level security;
revoke all on public.reader_ui_preferences from anon;
grant select, insert, update, delete on public.reader_ui_preferences to authenticated;

drop policy if exists reader_ui_preferences_owner on public.reader_ui_preferences;
create policy reader_ui_preferences_owner on public.reader_ui_preferences
  for all to authenticated
  using (private.is_owner() and user_id = (select auth.uid()))
  with check (private.is_owner() and user_id = (select auth.uid()));

drop trigger if exists reader_ui_preferences_updated_at on public.reader_ui_preferences;
create trigger reader_ui_preferences_updated_at
  before update on public.reader_ui_preferences
  for each row execute function private.set_updated_at();
