-- Migration: Rename address → address_backup
-- Date: 2026-04-16
-- Purpose: Preserve addresses for debugging but stop using them in app flow (venues now GPS-only)

ALTER TABLE venues RENAME COLUMN address TO address_backup;

-- Add comment for clarity
COMMENT ON COLUMN venues.address_backup IS 'Preserved for debugging/cross-reference. Not used in main app flow since all venues now have GPS coordinates.';

-- Verify
SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'venues' AND column_name LIKE '%address%';
