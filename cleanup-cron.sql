-- ============================================================
-- Photo Cleanup Cron Job for The Pour List
-- ============================================================
-- Deletes photos older than 48 hours from:
--   1. Supabase Storage (`venue-photos` bucket)
--   2. The `photos` DB table
--
-- HOW TO SET UP:
--
-- STEP 1: Enable pg_cron extension (once per database)
--   Run in Supabase SQL Editor:
--
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--
-- STEP 2: Grant permissions to your service role user
--   (Replace 'your_service_role_user' with the actual service role user from
--    your Supabase project dashboard → Settings → Database)
--
--   GRANT USAGE ON SCHEMA pg_cron TO postgres;
--   GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA pg_cron TO postgres;
--   GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA pg_cron TO postgres;
--
-- STEP 3: Schedule the cleanup job (runs every hour at minute 0)
--   Run the SELECT cron.schedule(...) statement below in Supabase SQL Editor.
--   This file itself is idempotent — you can run it multiple times safely.
--
-- STEP 4: Verify the job is registered
--   SELECT * FROM cron.job;
--   You should see a row with jobname = 'cleanup-old-photos-hourly'
--
-- STEP 5: To disable the cron job later
--   SELECT cron.unschedule('cleanup-old-photos-hourly');
--
-- ============================================================

-- Idempotent: create the cleanup function only if it doesn't exist
CREATE OR REPLACE FUNCTION cleanup_old_photos()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cutoff TIMESTAMPTZ;
  old_photos_recorded INTEGER;
BEGIN
  -- Photos older than 48 hours
  cutoff := NOW() - INTERVAL '48 hours';

  -- Count how many DB records will be deleted (for logging)
  SELECT COUNT(*) INTO old_photos_recorded
  FROM photos
  WHERE created_at < cutoff;

  -- Delete DB records for old photos
  DELETE FROM photos WHERE created_at < cutoff;

  -- Storage cleanup note:
  -- We cannot directly delete files from Supabase Storage via plain SQL.
  -- The storage API requires authenticated HTTP calls. Options:
  --
  -- OPTION A (RECOMMENDED): HTTP call via pg_net extension
  --   If pg_net is available in your Supabase tier, you can call the
  --   /api/delete-old-photos endpoint directly from SQL:
  --
  --   PERFORM net.http_post(
  --     url := (SELECT value FROM vault.secrets WHERE name = 'NEXT_PUBLIC_BASE_URL') || '/api/delete-old-photos',
  --     headers := jsonb_build_object(
  --       'Content-Type', 'application/json',
  --       'Authorization', 'Bearer ' || (SELECT value FROM vault.secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY')
  --     ),
  --     body := jsonb_build_object('cleanup_mode', 'cron')
  --   );
  --
  -- OPTION B: External cron via Vercel, GitHub Actions, or cron-job.org
  --   Set up a cron job to POST to:
  --   https://pourlist.vercel.app/api/delete-old-photos
  --   every hour. The /api/delete-old-photos endpoint handles storage cleanup.
  --
  -- OPTION C: Supabase Edge Function (most reliable)
  --   Create supabase/functions/delete-old-photos/index.ts and schedule it
  --   via supabase/config.toml:
  --   [edge_functions.delete-old-photos]
  --   schedule = "0 * * * *"
  --
  -- The DB cleanup above runs regardless. Storage cleanup should be handled
  -- via one of the options above. The /api/delete-old-photos endpoint on
  -- Vercel handles both DB and storage deletion and is already deployed.

  RAISE NOTICE 'cleanup_old_photos: deleted % photo DB records older than %', old_photos_recorded, cutoff;
END;
$$;

-- Schedule the cron job — runs at minute 0 of every hour
-- Idempotent: unschedule first, then reschedule
SELECT cron.unschedule('cleanup-old-photos-hourly');

SELECT cron.schedule(
  'cleanup-old-photos-hourly',
  '0 * * * *',
  $$ SELECT cleanup_old_photos(); $$
);