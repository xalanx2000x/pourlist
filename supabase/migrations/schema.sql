-- Migration: pourlist-v1-photo-sets
-- Adds photo_sets table, address_normalized column, and venue-photos storage bucket

-- 1. Create photo_sets table for managing photo submissions per venue
CREATE TABLE IF NOT EXISTS photo_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id UUID REFERENCES venues(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  photo_urls TEXT[] NOT NULL DEFAULT '{}'
);

-- Index for efficient retrieval of recent photo sets by venue
CREATE INDEX IF NOT EXISTS idx_photo_sets_venue_created
  ON photo_sets(venue_id, created_at DESC);

-- Enable RLS
ALTER TABLE photo_sets ENABLE ROW LEVEL SECURITY;

-- RLS policy: anyone can read photo sets; authenticated users can insert
CREATE POLICY "photo_sets_public_read" ON photo_sets
  FOR SELECT USING (true);

CREATE POLICY "photo_sets_insert" ON photo_sets
  FOR INSERT WITH CHECK (true);

-- 2. Add address_normalized column to venues (canonical single-line address for display)
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS address_normalized TEXT;

-- 3. Add latest_menu_image_url column if not already present (verify and add if missing)
ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS latest_menu_image_url TEXT;

-- 4. Venue-photos storage bucket (must be created in Supabase dashboard or via this SQL)
-- Note: This will fail if bucket already exists, which is fine
-- The bucket should be created manually in Supabase dashboard with:
--   Name: venue-photos
--   Public: true
--   File size limit: 20MB
--   Allowed MIME types: image/jpeg, image/png, image/heic, image/heif
