-- ============================================================
-- MODERATION SYSTEM MIGRATION — Run in Supabase SQL Editor
-- https://supabase.com/dashboard/project/cuzkquenafzebdqbuwfk/sql-editor
-- ============================================================
-- Copy everything below and paste into the SQL Editor, then Run
-- ============================================================

-- ── 1. Add columns to venues table ────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'venues' AND column_name = 'status') THEN
    ALTER TABLE venues ADD COLUMN status TEXT DEFAULT 'unverified';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'venues' AND column_name = 'last_verified') THEN
    ALTER TABLE venues ADD COLUMN last_verified TIMESTAMPTZ;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'venues' AND column_name = 'contributor_trust') THEN
    ALTER TABLE venues ADD COLUMN contributor_trust TEXT DEFAULT 'new';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'venues' AND column_name = 'last_flag_decay_at') THEN
    ALTER TABLE venues ADD COLUMN last_flag_decay_at TIMESTAMPTZ DEFAULT NOW();
  END IF;
END $$;

-- ── 2. Flags table ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_name = 'flags') THEN
    CREATE TABLE flags (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
      device_hash TEXT NOT NULL,
      reason TEXT NOT NULL CHECK (reason IN ('closed', 'wrong')),
      lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  END IF;
END $$;

-- ── 3. Index on flags(venue_id, active) — regular index, no WHERE clause ─
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'flags_venue_active_idx') THEN
    CREATE INDEX flags_venue_active_idx ON flags(venue_id, active);
  END IF;
END $$;

-- ── 4. Index on flags(venue_id, device_hash) ─────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'flags_device_venue_idx') THEN
    CREATE INDEX flags_device_venue_idx ON flags(venue_id, device_hash);
  END IF;
END $$;

-- ── 5. Venue flag events table ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_name = 'venue_flag_events') THEN
    CREATE TABLE venue_flag_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
      device_hash TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('flag', 'confirm', 'reopen')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(venue_id, device_hash, action)
    );
  END IF;
END $$;

-- ── 6. Index on venue_flag_events ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
    WHERE indexname = 'venue_flag_events_device_venue_idx') THEN
    CREATE INDEX venue_flag_events_device_venue_idx
      ON venue_flag_events(venue_id, device_hash);
  END IF;
END $$;

-- ── 7. Device submission count table ───────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_name = 'device_stats') THEN
    CREATE TABLE device_stats (
      device_hash TEXT PRIMARY KEY,
      submission_count INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  END IF;
END $$;

-- ── 8. increment_device_submissions ──────────────────────────
CREATE OR REPLACE FUNCTION increment_device_submissions(p_device_hash TEXT)
RETURNS VOID AS $$
  INSERT INTO device_stats (device_hash, submission_count, updated_at)
  VALUES (p_device_hash, 1, NOW())
  ON CONFLICT (device_hash)
  DO UPDATE SET
    submission_count = device_stats.submission_count + 1,
    updated_at = NOW();
$$ LANGUAGE SQL;

-- ── 9. get_device_submission_count ────────────────────────────
CREATE OR REPLACE FUNCTION get_device_submission_count(p_device_hash TEXT)
RETURNS INT AS $$
  SELECT COALESCE(submission_count, 0)
  FROM device_stats WHERE device_hash = p_device_hash;
$$ LANGUAGE SQL STABLE;

-- ── 10. can_device_flag_venue ─────────────────────────────────
CREATE OR REPLACE FUNCTION can_device_flag_venue(
  p_device_hash TEXT, p_venue_id UUID, p_today DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(can_flag BOOLEAN, reason TEXT) AS $$
DECLARE
  v_already_flagged BOOLEAN;
  v_has_confirmed BOOLEAN;
BEGIN
  IF get_device_submission_count(p_device_hash) < 1 THEN
    RETURN QUERY SELECT FALSE, 'no_submissions'::TEXT; RETURN;
  END IF;

  SELECT EXISTS(SELECT 1 FROM venue_flag_events
    WHERE venue_id = p_venue_id AND device_hash = p_device_hash AND action = 'flag')
  INTO v_already_flagged;
  IF v_already_flagged THEN
    RETURN QUERY SELECT FALSE, 'already_flagged'::TEXT; RETURN;
  END IF;

  SELECT EXISTS(SELECT 1 FROM venue_flag_events
    WHERE venue_id = p_venue_id AND device_hash = p_device_hash AND action = 'confirm')
  INTO v_has_confirmed;
  IF v_has_confirmed THEN
    RETURN QUERY SELECT FALSE, 'already_confirmed'::TEXT; RETURN;
  END IF;

  SELECT EXISTS(SELECT 1 FROM flags
    WHERE venue_id = p_venue_id AND device_hash = p_device_hash
      AND active = TRUE AND DATE(created_at) = p_today)
  INTO v_already_flagged;
  IF v_already_flagged THEN
    RETURN QUERY SELECT FALSE, 'daily_limit'::TEXT; RETURN;
  END IF;

  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 11. submit_flag ────────────────────────────────────────────
-- no_hh special case: 1 flag immediately closes the venue
-- (these venues have no HH data worth preserving — flag means "no HH program exists")
CREATE OR REPLACE FUNCTION submit_flag(
  p_venue_id UUID, p_device_hash TEXT, p_reason TEXT,
  p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION
)
RETURNS TABLE(success BOOLEAN, message TEXT, new_status TEXT) AS $$
DECLARE
  v_can_flag BOOLEAN; v_reason TEXT;
  v_weighted_sum INT; v_new_status TEXT;
BEGIN
  -- Special case: no_hh closes immediately (1 flag is sufficient)
  IF p_reason = 'no_hh' THEN
    -- Check not already flagged by this device today
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

  -- Standard flag path for 'wrong' and other reasons
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

-- ── 12. can_device_confirm_venue ───────────────────────────────
CREATE OR REPLACE FUNCTION can_device_confirm_venue(
  p_device_hash TEXT, p_venue_id UUID
)
RETURNS TABLE(can_confirm BOOLEAN, reason TEXT) AS $$
DECLARE v_has_flagged BOOLEAN; v_has_confirmed BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM venue_flag_events
    WHERE venue_id = p_venue_id AND device_hash = p_device_hash AND action = 'flag')
  INTO v_has_flagged;
  IF v_has_flagged THEN
    RETURN QUERY SELECT FALSE, 'has_flagged'::TEXT; RETURN;
  END IF;
  SELECT EXISTS(SELECT 1 FROM venue_flag_events
    WHERE venue_id = p_venue_id AND device_hash = p_device_hash AND action = 'confirm')
  INTO v_has_confirmed;
  IF v_has_confirmed THEN
    RETURN QUERY SELECT FALSE, 'already_confirmed'::TEXT; RETURN;
  END IF;
  RETURN QUERY SELECT TRUE, NULL::TEXT;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 13. confirm_venue ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION confirm_venue(
  p_venue_id UUID, p_device_hash TEXT
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE v_can_confirm BOOLEAN; v_reason TEXT;
BEGIN
  SELECT can_confirm, reason INTO v_can_confirm, v_reason
  FROM can_device_confirm_venue(p_device_hash, p_venue_id);
  IF NOT v_can_confirm THEN
    RETURN QUERY SELECT FALSE, v_reason; RETURN;
  END IF;
  BEGIN
    INSERT INTO venue_flag_events (venue_id, device_hash, action)
    VALUES (p_venue_id, p_device_hash, 'confirm');
  EXCEPTION WHEN unique_violation THEN
    RETURN QUERY SELECT FALSE, 'already_confirmed'::TEXT; RETURN;
  END;
  DELETE FROM flags WHERE venue_id = p_venue_id AND active = TRUE;
  UPDATE venues SET status = 'verified', last_verified = NOW() WHERE id = p_venue_id;
  RETURN QUERY SELECT TRUE, 'confirmed'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ── 14. reopen_venue ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION reopen_venue(
  p_venue_id UUID, p_device_hash TEXT
)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE v_has_flagged BOOLEAN; v_status TEXT;
BEGIN
  SELECT EXISTS(SELECT 1 FROM venue_flag_events
    WHERE venue_id = p_venue_id AND device_hash = p_device_hash AND action = 'flag')
  INTO v_has_flagged;
  IF v_has_flagged THEN
    RETURN QUERY SELECT FALSE, 'cannot_reopen_own_flag'::TEXT; RETURN;
  END IF;
  SELECT status INTO v_status FROM venues WHERE id = p_venue_id;
  IF v_status NOT IN ('stale', 'closed') THEN
    RETURN QUERY SELECT FALSE, 'not_closed'::TEXT; RETURN;
  END IF;
  INSERT INTO venue_flag_events (venue_id, device_hash, action)
  VALUES (p_venue_id, p_device_hash, 'reopen')
  ON CONFLICT (venue_id, device_hash, action) DO NOTHING;
  DELETE FROM flags WHERE venue_id = p_venue_id AND active = TRUE;
  UPDATE venues SET status = 'verified', last_verified = NOW() WHERE id = p_venue_id;
  RETURN QUERY SELECT TRUE, 'reopened'::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ── 15. recalculate_venue_status ──────────────────────────────
CREATE OR REPLACE FUNCTION recalculate_venue_status(p_venue_id UUID)
RETURNS VOID AS $$
DECLARE v_weighted_sum INT; v_new_status TEXT;
BEGIN
  SELECT COALESCE(SUM(
    CASE WHEN get_device_submission_count(f.device_hash) >= 10 THEN 2 ELSE 1 END
  ), 0)::INT INTO v_weighted_sum
  FROM flags f WHERE f.venue_id = p_venue_id AND f.active = TRUE;

  IF v_weighted_sum >= 4 THEN v_new_status := 'closed';
  ELSIF v_weighted_sum >= 2 THEN v_new_status := 'stale';
  ELSE v_new_status := 'verified';
  END IF;
  UPDATE venues SET status = v_new_status WHERE id = p_venue_id;
END;
$$ LANGUAGE plpgsql;

-- ── 16. decay_flags ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION decay_flags()
RETURNS INT AS $$
DECLARE v_venue_id UUID; v_oldest_flag_id UUID; v_decayed_count INT := 0;
BEGIN
  FOR v_venue_id IN
    SELECT DISTINCT venue_id FROM flags
    WHERE active = TRUE AND created_at < NOW() - INTERVAL '1 month'
  LOOP
    SELECT id INTO v_oldest_flag_id FROM flags
    WHERE venue_id = v_venue_id AND active = TRUE
    ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF v_oldest_flag_id IS NOT NULL THEN
      UPDATE flags SET active = FALSE WHERE id = v_oldest_flag_id;
      v_decayed_count := v_decayed_count + 1;
      PERFORM recalculate_venue_status(v_venue_id);
    END IF;
  END LOOP;
  RETURN v_decayed_count;
END;
$$ LANGUAGE plpgsql;

-- ── 17. clear_flags_on_menu_commit ───────────────────────────
CREATE OR REPLACE FUNCTION clear_flags_on_menu_commit(p_venue_id UUID)
RETURNS INT AS $$
DECLARE v_cleared INT;
BEGIN
  DELETE FROM flags WHERE venue_id = p_venue_id AND active = TRUE;
  GET DIAGNOSTICS v_cleared = ROW_COUNT;
  UPDATE venues SET status = 'verified', last_verified = NOW() WHERE id = p_venue_id;
  RETURN v_cleared;
END;
$$ LANGUAGE plpgsql;

-- ── 18. get_venue_flag_summary ─────────────────────────────────
CREATE OR REPLACE FUNCTION get_venue_flag_summary(p_venue_id UUID)
RETURNS TABLE(
  active_flag_count INT, distinct_device_count INT,
  venue_status TEXT, last_verified TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT COUNT(*)::INT, COUNT(DISTINCT f.device_hash)::INT,
         v.status, v.last_verified
  FROM flags f JOIN venues v ON v.id = f.venue_id
  WHERE f.venue_id = p_venue_id AND f.active = TRUE GROUP BY v.id;
END;
$$ LANGUAGE plpgsql;

-- ── Done ────────────────────────────────────────────────────────
SELECT 'Moderation system migration complete' AS result;
