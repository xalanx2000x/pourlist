/**
 * Migration 007: Reset OSM-seeded venues to unverified
 *
 * Approach:
 * 1. Reset ALL venues with contributor_trust = 'anonymous' to status = 'unverified'
 *    (conservative: catches all OSM-seeded venues regardless of content)
 * 2. Restore verified to venues that have definite user content:
 *    - menu_text IS NOT NULL (user typed/pasted HH text)
 *    - OR hh_type IS NOT NULL (user set structured HH schedule via scan flow)
 *    - OR has photos in the photos table
 *
 * Run: node --experimental-vm-modules supabase/migrations/007_reset_anonymous_venues.sql
 * Or paste the SQL below into Supabase SQL Editor.
 */

-- Step 1: Count before
SELECT
  status,
  count(*) as cnt
FROM venues
WHERE contributor_trust = 'anonymous'
GROUP BY status;

-- Step 2: Reset all anonymous-trust venues to unverified
UPDATE venues
SET status = 'unverified'
WHERE contributor_trust = 'anonymous'
  AND status != 'unverified';

-- Step 3: Restore verified status to venues with real user content
-- 3a: Has menu text entered by user
UPDATE venues
SET status = 'verified'
WHERE contributor_trust = 'anonymous'
  AND menu_text IS NOT NULL
  AND trim(menu_text) != ''
  AND status = 'unverified';

-- 3b: Has structured HH schedule (from scan flow)
UPDATE venues
SET status = 'verified'
WHERE contributor_trust = 'anonymous'
  AND hh_type IS NOT NULL
  AND status = 'unverified';

-- 3c: Has a menu photo uploaded
UPDATE venues
SET status = 'verified'
WHERE contributor_trust = 'anonymous'
  AND latest_menu_image_url IS NOT NULL
  AND status = 'unverified';

-- 3d: Has photos in the photos table
UPDATE venues v
SET status = 'verified'
FROM (
  SELECT DISTINCT venue_id FROM photos
) p
WHERE v.id = p.venue_id
  AND v.contributor_trust = 'anonymous'
  AND v.status = 'unverified';

-- Step 4: Report final status for anonymous-trust venues
SELECT
  status,
  count(*) as cnt
FROM venues
WHERE contributor_trust = 'anonymous'
GROUP BY status;

-- Step 5: Also reset any non-anonymous venues that are stuck in a bad state
-- (e.g., verified but no content)
UPDATE venues
SET status = 'unverified'
WHERE contributor_trust != 'anonymous'
  AND status = 'verified'
  AND (
    menu_text IS NULL
    OR trim(menu_text) = ''
  )
  AND hh_type IS NULL
  AND latest_menu_image_url IS NULL
  AND photo_count = 0;
