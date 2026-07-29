-- 022_backfill_tagline_from_type.sql
-- Backfill tagline from type for real user-submitted venues.
-- Seed pins keep tagline=null so they continue displaying type via the ?? fallback.
-- LEFT(type, 24) respects the tagline 24-char limit.
UPDATE venues
SET tagline = LEFT(type, 24)
WHERE is_seed_data = false
  AND tagline IS NULL
  AND type IS NOT NULL;
