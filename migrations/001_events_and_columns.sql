-- Pour List — Migration: add latest columns + events table
-- Run this in Supabase Dashboard → SQL Editor

alter table venues add column if not exists menu_text text;
alter table venues add column if not exists menu_text_updated_at timestamptz;
alter table venues add column if not exists latest_menu_image_url text;
alter table photos add column if not exists photo_hash text;

-- Analytics events table
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  device_hash text not null,
  venue_id uuid references venues(id) on delete set null,
  metadata jsonb,
  created_at timestamptz default now()
);

-- Indexes
create index if not exists events_name_idx on events(event_name);
create index if not exists events_device_idx on events(device_hash);
create index if not exists events_created_idx on events(created_at);
create index if not exists photos_venue_id_hash_idx on photos(venue_id, photo_hash);

-- RLS for events
alter table events enable row level security;
create policy "Public read events" on events for select using (true);
create policy "Public insert events" on events for insert with check (true);