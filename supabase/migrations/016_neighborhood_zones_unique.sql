-- Migration 016: add unique constraint to neighborhood_zones
-- Matches what upsert_neighborhood_zone() expects for ON CONFLICT

ALTER TABLE neighborhood_zones
  ADD CONSTRAINT uq_neighborhood_zones_city_state_name
  UNIQUE (city, state, display_name);
