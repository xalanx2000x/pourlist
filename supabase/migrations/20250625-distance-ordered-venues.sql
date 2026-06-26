-- Migration: distance-ordered-venues
-- Fix: getVenuesInBounds was ORDER BY name LIMIT 150 (alphabetical cap) —
-- venues past position 150 alphabetically were silently dropped even when
-- geographically central (e.g. "The Solo Club" at position 413/473 in Portland).
--
-- Fix: RPC orders by squared-distance from viewport center BEFORE LIMIT.
-- Real venues (is_seed_data=false) have NO cap — always returned in full.
-- Seed pins fill remaining budget (p_limit - real_count), capped at p_limit total.
-- Total rows ≤ p_limit so the cap always holds at the display level.
--
-- Distance formula uses longitude weighting: a degree of longitude covers
-- less ground than a degree of latitude (except at the equator). We weight
-- lng by cos(radians(center_lat)) so ((lat-c)^2 + ((lng-c)*cos(radians(c_lat)))^2)
-- is proportional to true ground distance — correct at any latitude.

CREATE OR REPLACE FUNCTION get_venues_in_bounds(
  p_north double precision,
  p_south double precision,
  p_east double precision,
  p_west double precision,
  p_center_lat double precision,
  p_center_lng double precision,
  p_limit int default 150
)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  new_slug text,
  lat double precision,
  lng double precision,
  address text,
  city text,
  state text,
  neighborhood text,
  country text,
  zip text,
  address_autofilled boolean,
  hh_type text,
  hh_days text,
  hh_exclude_days text,
  hh_start int,
  hh_end int,
  hh_type_2 text,
  hh_days_2 text,
  hh_exclude_days_2 text,
  hh_start_2 int,
  hh_end_2 int,
  hh_type_3 text,
  hh_days_3 text,
  hh_exclude_days_3 text,
  hh_start_3 int,
  hh_end_3 int,
  hh_time text,
  status text,
  is_seed_data boolean,
  type text,
  latest_menu_image_url text,
  dist_sq double precision
)
LANGUAGE plpgsql
AS $$
DECLARE
  real_count int;
  seed_limit int;
  -- Pre-compute the longitude weight once: makes lng contribution
  -- proportional to true ground distance at the viewport center.
  lng_weight double precision := cos(radians(p_center_lat));
BEGIN
  -- Real venues: always included, no cap. Ordered by weighted distance.
  -- Real venues are the primary signal — they must never be dropped.
  RETURN QUERY
  SELECT
    v.id, v.name, v.slug, v.new_slug, v.lat, v.lng,
    v.address, v.city, v.state, v.neighborhood, v.country, v.zip,
    v.address_autofilled,
    v.hh_type, v.hh_days, v.hh_exclude_days, v.hh_start, v.hh_end,
    v.hh_type_2, v.hh_days_2, v.hh_exclude_days_2, v.hh_start_2, v.hh_end_2,
    v.hh_type_3, v.hh_days_3, v.hh_exclude_days_3, v.hh_start_3, v.hh_end_3,
    v.hh_time, v.status, v.is_seed_data, v.type, v.latest_menu_image_url,
    ((v.lat - p_center_lat)^2 + ((v.lng - p_center_lng) * lng_weight)^2)::double precision AS dist_sq
  FROM venues v
  WHERE v.status != 'closed'
    AND v.lat IS NOT NULL AND v.lng IS NOT NULL
    AND v.lat BETWEEN p_south AND p_north
    AND v.lng BETWEEN p_west AND p_east
    AND v.is_seed_data = false
  ORDER BY dist_sq ASC;

  -- Capture how many real venues were returned
  GET DIAGNOSTICS real_count = ROW_COUNT;

  -- Seeds get the remaining budget: p_limit - real_count.
  -- If real venues already fill the budget, seeds get nothing (LIMIT 0).
  -- This guarantees total rows ≤ p_limit and real venues are never dropped.
  seed_limit := greatest(0, p_limit - real_count);

  RETURN QUERY
  SELECT
    v.id, v.name, v.slug, v.new_slug, v.lat, v.lng,
    v.address, v.city, v.state, v.neighborhood, v.country, v.zip,
    v.address_autofilled,
    v.hh_type, v.hh_days, v.hh_exclude_days, v.hh_start, v.hh_end,
    v.hh_type_2, v.hh_days_2, v.hh_exclude_days_2, v.hh_start_2, v.hh_end_2,
    v.hh_type_3, v.hh_days_3, v.hh_exclude_days_3, v.hh_start_3, v.hh_end_3,
    v.hh_time, v.status, v.is_seed_data, v.type, v.latest_menu_image_url,
    ((v.lat - p_center_lat)^2 + ((v.lng - p_center_lng) * lng_weight)^2)::double precision AS dist_sq
  FROM venues v
  WHERE v.status != 'closed'
    AND v.lat IS NOT NULL AND v.lng IS NOT NULL
    AND v.lat BETWEEN p_south AND p_north
    AND v.lng BETWEEN p_west AND p_east
    AND v.is_seed_data = true
  ORDER BY dist_sq ASC
  LIMIT seed_limit;
END;
$$;

-- Index for bounding-box + is_seed_data filter (used by the RPC)
CREATE INDEX IF NOT EXISTS idx_venues_bounds_seed
  ON venues(status, is_seed_data, lat, lng)
  WHERE status != 'closed';
