-- Pour List — Supabase Schema
-- Run this in Supabase Dashboard → SQL Editor

-- Enable PostGIS for geographic queries
create extension if not exists postgis;

-- Venues table
create table venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  lat double precision,
  lng double precision,
  zip text,
  phone text,
  website text,
  type text,
  status text default 'unverified' check (status in ('unverified', 'verified', 'stale', 'closed')),
  contributor_trust text default 'new',
  last_verified timestamptz,
  photo_count int default 0,
  created_at timestamptz default now()
);

-- Photos table
create table photos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues(id) on delete cascade,
  url text not null,
  uploader_device_hash text not null,
  lat double precision,
  lng double precision,
  status text default 'pending' check (status in ('pending', 'approved', 'rejected')),
  flagged_count int default 0,
  moderation_confidence double precision,
  created_at timestamptz default now()
);

-- Flags table (for moderation)
create table flags (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues(id) on delete set null,
  photo_id uuid references photos(id) on delete set null,
  reason text not null,
  device_hash text not null,
  created_at timestamptz default now()
);

-- Indexes for performance
create index venues_zip_idx on venues(zip);
create index venues_status_idx on venues(status);
create index photos_venue_id_idx on photos(venue_id);
create index photos_status_idx on photos(status);
create index flags_venue_id_idx on flags(venue_id);
create index flags_photo_id_idx on flags(photo_id);

-- Row Level Security (RLS) — allows public read, authenticated write
alter table venues enable row level security;
alter table photos enable row level security;
alter table flags enable row level security;

-- Everyone can read venues
create policy "Public read venues" on venues for select using (true);

-- Everyone can insert venues (for adding new ones)
create policy "Public insert venues" on venues for insert with check (true);

-- Everyone can update venues (for status changes)
create policy "Public update venues" on venues for update using (true);

-- Everyone can read photos
create policy "Public read photos" on photos for select using (true);

-- Everyone can insert photos
create policy "Public insert photos" on photos for insert with check (true);

-- Everyone can read flags
create policy "Public read flags" on flags for select using (true);

-- Everyone can insert flags
create policy "Public insert flags" on flags for insert with check (true);

-- Auto-update last_verified when a photo is approved
create or replace function update_venue_verified()
returns trigger as $$
begin
  if new.status = 'approved' and old.status = 'pending' then
    update venues set last_verified = now(), photo_count = photo_count + 1 where id = new.venue_id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger photo_approved_trigger
  after update of status on photos
  for each row execute function update_venue_verified();

-- Auto-stale venues with no verification in 90 days
create or replace function mark_stale_venues()
returns void as $$
begin
  update venues
  set status = 'stale'
  where status = 'verified'
    and (last_verified is null or last_verified < now() - interval '90 days');
end;
$$ language plpgsql;

-- Run this periodically in Supabase → Database → Extensions → pg_cron
-- Or run manually after large photo batches
-- select mark_stale_venues();
