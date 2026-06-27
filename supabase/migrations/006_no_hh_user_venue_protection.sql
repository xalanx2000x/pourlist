-- ============================================================
-- PROTECT USER-SUBMITTED VENUES FROM SOLO no_hh CLOSURE
-- Run in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/cuzkquenafzebdqbuwfk/sql-editor
-- ============================================================
--
-- Rule:
--   OSM venue (is_seed_data = true)  + no_hh flag → 1 flag closes immediately
--   User venue (is_seed_data = false) + no_hh flag → same weighted threshold as wrong
--
-- Weighted sum pools BOTH no_hh and wrong flags together (one shared bucket).
-- Thresholds: stale ≥2, closed ≥4. Trusted device (≥10 submissions) counts as 2.
-- Daily-limit guard (1 flag/venue/day) applies to both OSM and user paths.
--
-- All other moderation logic (confirm, reopen, decay, menu-commit-clears-flags)
-- is untouched.
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
  -- ── Daily-limit guard (applies to ALL flag attempts) ─────────────────
  -- Reject if this device already flagged this venue today.
  IF EXISTS(SELECT 1 FROM flags
    WHERE venue_id = p_venue_id AND device_hash = p_device_hash
      AND active = TRUE AND DATE(created_at) = CURRENT_DATE) THEN
    RETURN QUERY SELECT FALSE, 'daily_limit'::TEXT, NULL; RETURN;
  END IF;

  -- ── no_hh on OSM/seed venues: 1 flag closes immediately ───────────────
  -- OSM venues are unverified pins — no user data, no photo, no HH confirmed.
  -- One "no HH" report is sufficient signal to close the pin.
  -- User venues are protected: they go through the weighted threshold below.
  IF p_reason = 'no_hh' AND EXISTS(SELECT 1 FROM venues WHERE id = p_venue_id AND is_seed_data = TRUE) THEN
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

  -- ── User venue OR non-no_hh reason: shared weighted-threshold path ─────
  -- Both no_hh and wrong on user venues count in the SAME pooled bucket.
  -- The weighted sum is "how many independent people want this venue removed,"
  -- not "which reason they cited."  Pooled thresholds: stale ≥2, closed ≥4.
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

  -- Weighted sum: trusted device (≥10 submissions) counts as 2, else 1.
  -- ALL active flags (no_hh + wrong) pool together — one shared removal bucket.
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

-- ============================================================
SELECT 'Migration 006 applied: no_hh user-venue protection' AS result;