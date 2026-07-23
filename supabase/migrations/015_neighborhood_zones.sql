-- Migration 015: neighborhood_zones polygon table
-- Stores drawn GeoJSON polygons for cities with zone-based neighborhood resolution.
-- Operating rule: cities with zone polygons manage names exclusively through
-- neighborhood_zones; neighborhood_map text table is only for cities without polygons.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE neighborhood_zones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  city         TEXT NOT NULL,
  state        TEXT NOT NULL,
  display_name TEXT NOT NULL,
  geometry     geography(Polygon, 4326) NOT NULL,
  is_active    BOOLEAN DEFAULT false NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Spatial index for fast point-in-polygon
CREATE INDEX idx_neighborhood_zones_geom ON neighborhood_zones USING GIST (geometry);

-- Filtered index for active zone lookup by city/state
CREATE INDEX idx_neighborhood_zones_active
  ON neighborhood_zones (city, state)
  WHERE is_active = true;

-- RLS: service_role only — NOT USING (true)
ALTER TABLE neighborhood_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "neighborhood_zones_admin_all" ON neighborhood_zones
  FOR ALL USING (auth.role() = 'service_role');
