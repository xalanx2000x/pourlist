-- ============================================================
-- Fingerprint Column Migration for The Pour List
-- ============================================================
-- Adds a `fingerprint` column to the `photos` table for duplicate detection.
-- The fingerprint is the client-generated string from imageHash.ts
-- (format: `${file.size}-${file.name.toLowerCase().trim()}-${file.lastModified}`)
--
-- HOW TO RUN:
--   1. Go to your Supabase project dashboard: https://supabase.com/dashboard
--   2. Navigate to: SQL Editor → New Query
--   3. Paste this entire file and click "Run"
-- ============================================================

-- Add fingerprint column (text) to photos table — idempotent
ALTER TABLE photos ADD COLUMN IF NOT EXISTS fingerprint TEXT;

-- Create index for fast duplicate lookups by fingerprint + device
-- This speeds up the check-duplicate query which looks for matching
-- fingerprints from the same device within a 24h window
CREATE INDEX IF NOT EXISTS idx_photos_fingerprint_device
  ON photos (uploader_device_hash, fingerprint)
  WHERE fingerprint IS NOT NULL;

-- Also backfill fingerprint = photo_hash for existing rows (one-time)
-- This is safe to run multiple times — it only updates rows where fingerprint is null
UPDATE photos
SET fingerprint = photo_hash
WHERE fingerprint IS NULL
  AND photo_hash IS NOT NULL;

COMMENT ON COLUMN photos.fingerprint IS
  'Client-generated fingerprint from imageHash.ts: size-name-lastModified';