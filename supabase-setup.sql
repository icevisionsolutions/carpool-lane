-- ============================================================
--  IVS Carpool — Supabase setup
--  Run this ONCE in your Supabase project:
--  Supabase dashboard → SQL Editor → New query → paste → Run.
-- ============================================================

-- 1. Table that stores every carpool. Each carpool is one row:
--    id = a slug of the carpool's name, payload = its whole calendar.
create table if not exists carpool (
  id text primary key,
  payload jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- 2. Row Level Security on, with open read/write.
--    Each carpool is protected by its own name + password inside the app.
alter table carpool enable row level security;

create policy "anyone can read carpool"
  on carpool for select using (true);

create policy "anyone can insert carpool"
  on carpool for insert with check (true);

create policy "anyone can update carpool"
  on carpool for update using (true) with check (true);

-- 3. Let realtime broadcast changes so members see updates live.
alter publication supabase_realtime add table carpool;
