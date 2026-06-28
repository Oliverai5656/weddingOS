-- Wedding Plan Task 00 schema for Supabase Postgres.
-- Run this in Supabase Dashboard > SQL Editor before setting DATA_BACKEND=supabase.

create table if not exists public.app_users (
  id text primary key,
  name text not null,
  email text not null unique,
  created_at timestamptz not null default now(),
  _row_guard text not null default 'row'
);

create table if not exists public.weddings (
  id text primary key,
  name text not null,
  date date,
  total_budget numeric not null default 0,
  size_estimate integer not null default 0,
  created_by text not null references public.app_users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  _row_guard text not null default 'row'
);

create table if not exists public.wedding_members (
  wedding_id text not null references public.weddings(id) on delete cascade,
  user_id text not null references public.app_users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  _row_guard text not null default 'row',
  primary key (wedding_id, user_id)
);

create table if not exists public.ceremonies (
  id text primary key,
  wedding_id text not null references public.weddings(id) on delete cascade,
  name text not null,
  type text not null,
  date date,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  _row_guard text not null default 'row'
);

create table if not exists public.tasks (
  id text primary key,
  wedding_id text not null references public.weddings(id) on delete cascade,
  ceremony_id text references public.ceremonies(id) on delete set null,
  title text not null,
  due_date date,
  "group" text not null check ("group" in ('now', 'soon', 'later')),
  status text not null check (status in ('open', 'done')),
  assignee text references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  _row_guard text not null default 'row'
);

create table if not exists public.budget_items (
  id text primary key,
  wedding_id text not null references public.weddings(id) on delete cascade,
  category text not null,
  planned_amount numeric not null default 0,
  actual_amount numeric,
  type text not null check (type in ('expense', 'income')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  _row_guard text not null default 'row'
);

create table if not exists public.guests (
  id text primary key,
  wedding_id text not null references public.weddings(id) on delete cascade,
  name text not null,
  status text not null check (status in ('invited', 'confirmed', 'declined')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  _row_guard text not null default 'row'
);

create table if not exists public.guest_ceremonies (
  guest_id text not null references public.guests(id) on delete cascade,
  ceremony_id text not null references public.ceremonies(id) on delete cascade,
  _row_guard text not null default 'row',
  primary key (guest_id, ceremony_id)
);

create table if not exists public.invites (
  token text primary key,
  wedding_id text not null references public.weddings(id) on delete cascade,
  expires_at timestamptz not null,
  created_by text not null references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  _row_guard text not null default 'row'
);

create table if not exists public.notes (
  id text primary key,
  wedding_id text not null references public.weddings(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  _row_guard text not null default 'row'
);

create table if not exists public.activity (
  id text primary key,
  wedding_id text not null references public.weddings(id) on delete cascade,
  user_id text references public.app_users(id) on delete set null,
  action text not null,
  label text not null,
  created_at timestamptz not null default now(),
  _row_guard text not null default 'row'
);

create index if not exists idx_wedding_members_user_id on public.wedding_members(user_id);
create index if not exists idx_ceremonies_wedding_id on public.ceremonies(wedding_id);
create index if not exists idx_tasks_wedding_id on public.tasks(wedding_id);
create index if not exists idx_budget_items_wedding_id on public.budget_items(wedding_id);
create index if not exists idx_guests_wedding_id on public.guests(wedding_id);
create index if not exists idx_guest_ceremonies_ceremony_id on public.guest_ceremonies(ceremony_id);
create index if not exists idx_invites_wedding_id on public.invites(wedding_id);
create index if not exists idx_activity_wedding_id_created_at on public.activity(wedding_id, created_at desc);

alter table public.app_users enable row level security;
alter table public.weddings enable row level security;
alter table public.wedding_members enable row level security;
alter table public.ceremonies enable row level security;
alter table public.tasks enable row level security;
alter table public.budget_items enable row level security;
alter table public.guests enable row level security;
alter table public.guest_ceremonies enable row level security;
alter table public.invites enable row level security;
alter table public.notes enable row level security;
alter table public.activity enable row level security;

-- No anon/authenticated RLS policies are added yet because this app currently
-- reads/writes through the local Node server using SUPABASE_SERVICE_ROLE_KEY.
-- The browser must not call these tables directly until Supabase Auth is added.
