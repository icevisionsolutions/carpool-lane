-- ============================================================
--  The Carpool Lane — Supabase setup
--  Run this ONCE in your Supabase project:
--  Supabase dashboard → SQL Editor → New query → paste → Run.
-- ============================================================

-- 1. Table that stores the whole shared calendar as one JSON blob.
create table if not exists carpool (
  id text primary key,
  payload jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- 2. Seed the single shared row the app reads/writes.
insert into carpool (id, payload)
values ('main', '{"families":[],"shifts":[],"schoolDaysOnly":true,"passwordOff":false}')
on conflict (id) do nothing;

-- 3. Turn on Row Level Security, then allow read + write.
--    (The app is already protected by your shared password in the UI.)
alter table carpool enable row level security;

create policy "anyone can read carpool"
  on carpool for select using (true);

create policy "anyone can insert carpool"
  on carpool for insert with check (true);

create policy "anyone can update carpool"
  on carpool for update using (true) with check (true);

-- 4. Let realtime broadcast changes so families see updates live.
alter publication supabase_realtime add table carpool;
