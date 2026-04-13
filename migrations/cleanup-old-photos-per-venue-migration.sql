-- ============================================================
-- Per-Venue Photo Retention (Keep 3 Most Recent) for The Pour List
-- ============================================================
-- Replaces time-based 48h cleanup with a "keep last 3 per venue" strategy.
--
-- When a 4th photo is uploaded to the same venue, the oldest non-approved
-- photo is permanently deleted from both the DB and Supabase Storage.
--
-- HOW TO RUN:
--   1. Go to your Supabase project dashboard: https://supabase.com/dashboard
--   2. Navigate to: SQL Editor → New Query
--   3. Paste this entire file and click "Run"
--
-- Idempotent: uses CREATE OR REPLACE FUNCTION so safe to re-run.
-- ============================================================

-- ----------------------------------------------------------------
-- FUNCTION: cycle_old_photos
-- ----------------------------------------------------------------
-- Called by the application after inserting a new photo record.
-- Finds all photos for the given venue older than the 3rd most recent,
-- deletes their DB records, and returns their storage file paths so
-- the caller can delete the corresponding files from Supabase Storage.
--
-- IMPORTANT: Photos with status = 'approved' are NEVER deleted.
--
-- Args:
--   p_venue_id UUID — the venue whose photos should be cycled
--
-- Returns:
--   Table of (deleted_id UUID, storage_path TEXT)
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION cycle_old_photos(p_venue_id UUID)
RETURNS TABLE(deleted_id UUID, storage_path TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Return the 4th+ oldest non-approved photos for this venue.
  -- The 3 most recent are kept regardless of age.
  -- Photos with status = 'approved' are always excluded.
  RETURN QUERY
  WITH ranked AS (
    SELECT
      id,
      url,
      status,
      created_at,
      ROW_NUMBER() OVER (
        PARTITION BY venue_id
        ORDER BY created_at DESC
      ) AS recency_rank
    FROM photos
    WHERE venue_id = p_venue_id
      AND status != 'approved'
  )
  SELECT r.id, r.url
  FROM ranked r
  WHERE r.recency_rank > 3;

  -- Delete the identified photo records
  -- (the returned rows above represent what's about to be deleted)
  DELETE FROM photos
  WHERE id IN (
    SELECT r.id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY venue_id
          ORDER BY created_at DESC
        ) AS recency_rank
      FROM photos
      WHERE venue_id = p_venue_id
        AND status != 'approved'
    ) r
    WHERE r.recency_rank > 3
  );
END;
$$;

-- ----------------------------------------------------------------
-- NOTE ON STORAGE FILE DELETION
-- ----------------------------------------------------------------
-- This function deletes DB records only. The corresponding files in
-- Supabase Storage ('venue-photos' bucket) must be deleted separately.
--
-- The storage paths are returned by this function so the caller can
-- make the Supabase Storage API delete call.
--
-- If pg_net is available in your Supabase tier (Pro/Enterprise),
-- you can extend this function to also call the Supabase Storage API.
-- On the free tier, storage cleanup must happen from the application
-- layer (the Vercel /api/delete-old-photos endpoint handles this).
-- ----------------------------------------------------------------

-- ----------------------------------------------------------------
-- TO ENABLE pg_net HTTP calls (Pro/Enterprise Supabase only):
-- ----------------------------------------------------------------
-- After confirming pg_net is enabled, uncomment and run:
--
-- CREATE OR REPLACE FUNCTION cycle_old_photos(p_venue_id UUID)
-- RETURNS TABLE(deleted_id UUID, storage_path TEXT)
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- AS $$
-- DECLARE
--   row_record RECORD;
-- BEGIN
--   FOR row_record IN
--     WITH ranked AS (
--       SELECT
--         id,
--         url,
--         status,
--         ROW_NUMBER() OVER (
--           PARTITION BY venue_id
--           ORDER BY created_at DESC
--         ) AS recency_rank
--       FROM photos
--       WHERE venue_id = p_venue_id
--         AND status != 'approved'
--     )
--     SELECT r.id, r.url
--     FROM ranked r
--     WHERE r.recency_rank > 3
--   LOOP
--     -- Return this row
--     deleted_id := row_record.id;
--     storage_path := row_record.url;
--     RETURN NEXT;
--
--     -- Delete from storage via pg_net
--     PERFORM net.http_delete(
--       url := row_record.url
--     );
--   END LOOP;
--
--   -- Delete DB records
--   DELETE FROM photos
--   WHERE id IN (
--     SELECT r.id
--     FROM (
--       SELECT
--         id,
--         ROW_NUMBER() OVER (
--           PARTITION BY venue_id
--           ORDER BY created_at DESC
--         ) AS recency_rank
--       FROM photos
--       WHERE venue_id = p_venue_id
--         AND status != 'approved'
--     ) r
--     WHERE r.recency_rank > 3
--   );
-- END;
-- $$;
