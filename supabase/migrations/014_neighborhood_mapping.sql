-- Migration 014: neighborhood_map table + neighborhood_raw rollback column
--
-- PART 1: Add neighborhood_raw column to venues
-- Stores the original Mapbox neighborhood name permanently, untouched by any
-- future mapping change. This is the rollback/escape-hatch for a bad merge.
-- Backfilled immediately below.
ALTER TABLE venues ADD COLUMN IF NOT EXISTS neighborhood_raw TEXT;

-- PART 2: neighborhood_map translation table
-- Maps raw Mapbox neighborhood names → human-readable display names.
-- Unique constraint on (city, state, mapbox_neighborhood) prevents duplicate
-- mappings for the same raw triple.
-- Multiple raw names can map to the same display_name (many-to-one) — this
-- is the mechanism for merging neighborhoods.
CREATE TABLE IF NOT EXISTS neighborhood_map (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city        TEXT NOT NULL,
  state       TEXT NOT NULL,
  mapbox_neighborhood  TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (city, state, mapbox_neighborhood)
);

-- Index for fast lookups at write time
CREATE INDEX IF NOT EXISTS idx_neighborhood_map_lookup
  ON neighborhood_map (city, state, mapbox_neighborhood);

-- RLS: seed admin tool only (authenticated via seed auth cookie)
ALTER TABLE neighborhood_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "neighborhood_map_admin_all" ON neighborhood_map
  FOR ALL USING (true);

-- PART 3: Backfill neighborhood_raw for ALL existing Manhattan venues
-- Run immediately so the escape-hatch is complete before any mapping exists.
-- neighborhood_map starts empty, so this is safe — substitution won't fire yet.
UPDATE venues
SET neighborhood_raw = neighborhood
WHERE neighborhood IS NOT NULL
  AND city = 'New York'
  AND state = 'NY';

-- Also backfill for any other cities that already have neighborhoods set
-- (future-proofing: if this migration runs after more cities are seeded,
--  those get the escape-hatch too without a separate migration)
UPDATE venues
SET neighborhood_raw = neighborhood
WHERE neighborhood IS NOT NULL
  AND neighborhood_raw IS NULL;
