-- Migration: add hh_updated_at column for tracking HH data staleness
-- hh_updated_at = timestamp when this venue's HH data was last created or confirmed.
-- When set: current HH data has been verified at this moment.
-- Null: HH data has never been specifically re-verified (use last_verified ?? created_at).

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS hh_updated_at TIMESTAMPTZ;

-- Backfill: set hh_updated_at to last_verified ?? created_at for existing real venues with HH data.
-- This gives us staleness sorting for existing venues immediately.
UPDATE venues
SET hh_updated_at = COALESCE(last_verified, created_at)
WHERE hh_updated_at IS NULL
  AND status != 'unverified'
  AND hh_type IS NOT NULL;
