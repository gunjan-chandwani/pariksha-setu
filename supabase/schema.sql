-- Pariksha Setu persistence bootstrap.
-- Run in Supabase Dashboard > SQL Editor using the project owner account.
create table if not exists public.portal_state (
  id text primary key check (id = 'main'),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- The browser never accesses this table directly. All reads/writes go through
-- server.js, which uses SUPABASE_SERVICE_ROLE_KEY on the server only.
alter table public.portal_state enable row level security;
revoke all on table public.portal_state from anon, authenticated;

-- Optional backup snapshots (recommended for production operations).
create table if not exists public.portal_state_backups (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  created_by text,
  data jsonb not null
);
alter table public.portal_state_backups enable row level security;
revoke all on table public.portal_state_backups from anon, authenticated;


-- Production sign-in role mapping. Create users in Supabase Authentication first,
-- then insert their auth.users UUID and approved portal role here.
create table if not exists public.portal_user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('Faculty', 'COE', 'Moderator')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.portal_user_roles enable row level security;
revoke all on table public.portal_user_roles from anon, authenticated;
