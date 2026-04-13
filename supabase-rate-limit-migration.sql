-- ============================================================
-- Server-Side Rate Limiting Migration for The Pour List
-- ============================================================
-- HOW TO RUN THIS MIGRATION:
--   1. Go to your Supabase project dashboard: https://supabase.com/dashboard
--   2. Navigate to: SQL Editor → New Query
--   3. Paste this entire file and click "Run"
--   4. (Optional) Enable automatic cleanup by setting up a pg_cron job:
--      SELECT cron.schedule('cleanup-rate-limits', '*/5 * * * *',
--        $$DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour'$$);
--
-- RATE LIMIT WINDOWS (enforced via check_rate_limit function calls):
--   upload-photo : 10 requests per 3600 seconds (1 hour) per device
--   submit-menu  : 20 requests per 3600 seconds (1 hour) per device
--   parse-menu   : 30 requests per 3600 seconds (1 hour) per device
-- ============================================================

-- Idempotent: only creates if not exists
CREATE TABLE IF NOT EXISTS rate_limits (
  device_hash  TEXT NOT NULL,
  action       TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (device_hash, action)
);

-- Index for efficient cleanup of expired windows
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits (window_start);

-- ============================================================
-- check_rate_limit(device_hash, action, max_requests, window_seconds)
--
-- Returns TRUE  if the request is allowed (under the limit)
-- Returns FALSE if the device has exceeded the limit in the current window
--
-- Behaviour per call:
--   1. Delete rows older than the window (cleanup)
--   2. If no row exists → INSERT count=1, return TRUE
--   3. If count < max_requests → UPDATE count+1, return TRUE
--   4. If count >= max_requests → return FALSE (rate limited)
-- ============================================================
CREATE OR REPLACE FUNCTION check_rate_limit(
  p_device_hash   TEXT,
  p_action        TEXT,
  p_max_requests  INTEGER,
  p_window_seconds INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER  -- runs with caller privileges so it can write to rate_limits
AS $$
DECLARE
  current_count INTEGER;
BEGIN
  -- Step 1: Cleanup — remove rows whose window has expired
  DELETE FROM rate_limits
  WHERE device_hash = p_device_hash
    AND action = p_action
    AND window_start < NOW() - (p_window_seconds || ' seconds')::INTERVAL;

  -- Step 2: Read current count for this device+action
  SELECT count INTO current_count
  FROM rate_limits
  WHERE device_hash = p_device_hash
    AND action = p_action;

  -- Step 3a: No row yet — insert and allow
  IF current_count IS NULL THEN
    INSERT INTO rate_limits (device_hash, action, count, window_start)
    VALUES (p_device_hash, p_action, 1, NOW());
    RETURN TRUE;

  -- Step 3b: Under the limit — increment and allow
  ELSIF current_count < p_max_requests THEN
    UPDATE rate_limits
    SET count = count + 1, window_start = NOW()
    WHERE device_hash = p_device_hash
      AND action = p_action;
    RETURN TRUE;

  -- Step 3c: At or over the limit — deny
  ELSE
    RETURN FALSE;
  END IF;
END;
$$;
