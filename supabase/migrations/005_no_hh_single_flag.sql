-- ============================================================
-- FIX: no_hh flag closes venue with 1 flag immediately
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/cuzkquenafzebdqbuwfk/sql-editor
-- ============================================================

CREATE OR REPLACE FUNCTION submit_flag(
  p_venue_id UUID, p_device_hash TEXT, p_reason TEXT,
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION
)
RETURNS TABLE(success BOOLEAN, message TEXT, new_status TEXT) AS $$
DECLARE
  v_can_flag BOOLEAN; v_reason TEXT;
  v_weighted_sum INT; v_new_status TEXT;
BEGIN
  -- Special case: no_hh closes immediately with 1 flag
  -- (venues with no HH data: one "no HH" report = venue has no HH program)
  IF p_reason = 'no_hh' THEN
    -- Already flagged by this device today → reject
    IF EXISTS(SELECT 1 FROM flags
      WHERE venue_id = p_venue_id AND device_hash = p_device_hash
        AND active = TRUE AND DATE(created_at) = CURRENT_DATE) THEN
      RETURN QUERY SELECT FALSE, 'daily_limit'::TEXT, NULL; RETURN;
    END IF;

    INSERT INTO flags (venue_id, device_hash, reason, lat, lng, active)
    VALUES (p_venue_id, p_device_hash, p_reason, p_lat, p_lng, TRUE);

    BEGIN
      INSERT INTO venue_flag_events (venue_id, device_hash, action)
      VALUES (p_venue_id, p_device_hash, 'flag');
    EXCEPTION WHEN unique_violation THEN
      RETURN QUERY SELECT FALSE, 'already_flagged'::TEXT, NULL; RETURN;
    END;

    UPDATE venues SET status = 'closed' WHERE id = p_venue_id;
    RETURN QUERY SELECT TRUE, 'flag_submitted'::TEXT, 'closed'::TEXT; RETURN;
  END IF;

  -- Standard path for 'wrong' and other reasons (weighted threshold system)
  SELECT can_flag, reason INTO v_can_flag, v_reason
  FROM can_device_flag_venue(p_device_hash, p_venue_id);
  IF NOT v_can_flag THEN
    RETURN QUERY SELECT FALSE, v_reason, NULL; RETURN;
  END IF;

  INSERT INTO flags (venue_id, device_hash, reason, lat, lng)
  VALUES (p_venue_id, p_device_hash, p_reason, p_lat, p_lng);

  BEGIN
    INSERT INTO venue_flag_events (venue_id, device_hash, action)
    VALUES (p_venue_id, p_device_hash, 'flag');
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT FALSE, 'already_flagged'::TEXT, NULL; RETURN;
  END;

  SELECT COALESCE(SUM(
    CASE WHEN get_device_submission_count(f.device_hash) >= 10 THEN 2 ELSE 1 END
  ), 0)::INT INTO v_weighted_sum
  FROM flags f WHERE f.venue_id = p_venue_id AND f.active = TRUE;

  IF v_weighted_sum >= 4 THEN v_new_status := 'closed';
  ELSIF v_weighted_sum >= 2 THEN v_new_status := 'stale';
  ELSE v_new_status := NULL;
  END IF;

  IF v_new_status IS NOT NULL THEN
    UPDATE venues SET status = v_new_status WHERE id = p_venue_id;
  END IF;

  RETURN QUERY SELECT TRUE, 'flag_submitted'::TEXT, v_new_status;
END;
$$ LANGUAGE plpgsql;