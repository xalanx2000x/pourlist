-- ============================================================
-- HH WINDOW DELETION — schema + RPC
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/cuzkquenafzebdqbuwfk/sql-editor
-- ============================================================
-- Let Tyler run both blocks together; this file mirrors what he pastes.
-- Copy everything below and paste into the SQL Editor, then Run.
-- ============================================================

-- Block A ── schema: nullable SMALLINT on flags ───────────────────
ALTER TABLE flags ADD COLUMN window_slot SMALLINT
 CHECK (window_slot IN (1, 2, 3));
-- Nullable: existing venue-level flags have no slot.
-- 'wrong' reason now also used for per-window deletions:
--   window_slot IS NULL    → venue-level 'wrong' (legacy)
--   window_slot IN (1,2,3) → per-window HH deletion

-- Block B ── RPC: delete_hh_window ───────────────────────────────
-- Mirrors submit_flag's pattern. Threshold 1: any verified user with
-- ≥1 submission can delete one specific HH window. Recorded as a
-- flag row with window_slot set. GPS presence stays in the API route.
CREATE OR REPLACE FUNCTION delete_hh_window(
  p_venue_id UUID, p_device_hash TEXT, p_window_slot SMALLINT,
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION
)
RETURNS TABLE(success BOOLEAN, message TEXT, new_status TEXT) AS $$
DECLARE
  v_slot_type TEXT;
  v_slot_start INT;
  v_new_status TEXT;
BEGIN
  -- 1. Global daily-limit guard — mirrors submit_flag top guard.
  IF EXISTS(SELECT 1 FROM flags
    WHERE device_hash = p_device_hash
      AND active = TRUE AND DATE(created_at) = CURRENT_DATE) THEN
    RETURN QUERY SELECT FALSE, 'daily_limit'::TEXT, NULL; RETURN;
  END IF;

  -- 2. Submission-count guard.
  IF get_device_submission_count(p_device_hash) < 1 THEN
    RETURN QUERY SELECT FALSE, 'no_submissions'::TEXT, NULL; RETURN;
  END IF;

  -- 3. Read current slot to validate presence.
  IF p_window_slot = 1 THEN
    SELECT hh_type, hh_start INTO v_slot_type, v_slot_start
    FROM venues WHERE id = p_venue_id;
  ELSIF p_window_slot = 2 THEN
    SELECT hh_type_2, hh_start_2 INTO v_slot_type, v_slot_start
    FROM venues WHERE id = p_venue_id;
  ELSIF p_window_slot = 3 THEN
    SELECT hh_type_3, hh_start_3 INTO v_slot_type, v_slot_start
    FROM venues WHERE id = p_venue_id;
  END IF;

  IF v_slot_type IS NULL OR v_slot_start IS NULL THEN
    RETURN QUERY SELECT FALSE, 'empty_slot'::TEXT, NULL; RETURN;
  END IF;

  -- 4. Audit flag row + venue_flag_events (matches submit_flag).
  INSERT INTO flags (venue_id, device_hash, reason, lat, lng, active, window_slot)
  VALUES (p_venue_id, p_device_hash, 'wrong', p_lat, p_lng, TRUE, p_window_slot);

  BEGIN
    INSERT INTO venue_flag_events (venue_id, device_hash, action)
    VALUES (p_venue_id, p_device_hash, 'flag');
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT FALSE, 'already_flagged'::TEXT, NULL; RETURN;
  END;

  -- 5. Null ALL columns for the slot (full-slot nulling rule).
  UPDATE venues SET
    hh_type          = CASE WHEN p_window_slot = 1 THEN NULL ELSE hh_type          END,
    hh_days          = CASE WHEN p_window_slot = 1 THEN NULL ELSE hh_days          END,
    hh_exclude_days  = CASE WHEN p_window_slot = 1 THEN NULL ELSE hh_exclude_days  END,
    hh_start         = CASE WHEN p_window_slot = 1 THEN NULL ELSE hh_start         END,
    hh_end           = CASE WHEN p_window_slot = 1 THEN NULL ELSE hh_end           END,
    hh_type_2        = CASE WHEN p_window_slot = 2 THEN NULL ELSE hh_type_2        END,
    hh_days_2        = CASE WHEN p_window_slot = 2 THEN NULL ELSE hh_days_2        END,
    hh_exclude_days_2 = CASE WHEN p_window_slot = 2 THEN NULL ELSE hh_exclude_days_2 END,
    hh_start_2       = CASE WHEN p_window_slot = 2 THEN NULL ELSE hh_start_2       END,
    hh_end_2         = CASE WHEN p_window_slot = 2 THEN NULL ELSE hh_end_2         END,
    hh_type_3        = CASE WHEN p_window_slot = 3 THEN NULL ELSE hh_type_3        END,
    hh_days_3        = CASE WHEN p_window_slot = 3 THEN NULL ELSE hh_days_3        END,
    hh_exclude_days_3 = CASE WHEN p_window_slot = 3 THEN NULL ELSE hh_exclude_days_3 END,
    hh_start_3       = CASE WHEN p_window_slot = 3 THEN NULL ELSE hh_start_3       END,
    hh_end_3         = CASE WHEN p_window_slot = 3 THEN NULL ELSE hh_end_3         END
  WHERE id = p_venue_id;

  -- 6. If every HH column + hh_time are now null → status = 'stale'.
  IF (SELECT hh_type   FROM venues WHERE id = p_venue_id) IS NULL
     AND (SELECT hh_type_2 FROM venues WHERE id = p_venue_id) IS NULL
     AND (SELECT hh_type_3 FROM venues WHERE id = p_venue_id) IS NULL
     AND (SELECT hh_time   FROM venues WHERE id = p_venue_id) IS NULL THEN
    UPDATE venues SET status = 'stale' WHERE id = p_venue_id;
    v_new_status := 'stale';
  ELSE
    v_new_status := NULL;
  END IF;

  RETURN QUERY SELECT TRUE, 'window_deleted'::TEXT, v_new_status;
END;
$$ LANGUAGE plpgsql;

SELECT 'HH window deletion migration complete' AS result;
