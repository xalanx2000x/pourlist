-- 021_venue_tagline.sql
-- Add venue tagline column (24 chars, e.g. "Cocktail Bar")

ALTER TABLE venues ADD COLUMN IF NOT EXISTS tagline TEXT;
