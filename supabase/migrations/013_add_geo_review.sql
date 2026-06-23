-- 013_add_geo_review.sql
-- Adds columns for the new SEO-friendly URL structure.
-- Forward-only: does not touch existing data or slugs.
--
-- new_slug:         full URL path /{state}/{city}/{venueSlug} — nullable until Phase 3
-- needs_geo_review: true when state or city is missing/ambiguous at slug-generation time

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS new_slug         TEXT,
  ADD COLUMN IF NOT EXISTS needs_geo_review  BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for fast geo-review queue queries
CREATE INDEX IF NOT EXISTS idx_venues_needs_geo_review
  ON venues (needs_geo_review)
  WHERE needs_geo_review = TRUE;
