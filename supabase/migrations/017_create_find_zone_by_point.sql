-- Migration 017: Create find_zone_by_point RPC
-- Used by neighborhood-substitution.ts to resolve lat/lng → zone display_name
-- via PostGIS ST_Contains against the neighborhood_zones polygon table.

CREATE OR REPLACE FUNCTION find_zone_by_point(p_lat double precision, p_lng double precision)
RETURNS text AS $$
DECLARE
  zone_name text;
BEGIN
  SELECT display_name INTO zone_name
  FROM neighborhood_zones
  WHERE is_active = true
    AND ST_Contains(geometry, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326))
  LIMIT 1;
  RETURN zone_name;
END;
$$ LANGUAGE plpgsql STABLE;
