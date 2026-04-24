-- Tracks venue engagement events for internal analytics and resale
CREATE TABLE IF NOT EXISTS venue_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id    UUID REFERENCES venues(id) ON DELETE CASCADE NOT NULL,
  event_type  TEXT NOT NULL,                          -- 'view', 'hh_confirm', 'photo_upload'
  device_hash TEXT,                                   -- anonymous device fingerprint, for deduplication
  lat         NUMERIC,
  lng         NUMERIC,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_venue_events_venue_id_created_at
  ON venue_events (venue_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_venue_events_event_type
  ON venue_events (event_type);
CREATE INDEX IF NOT EXISTS idx_venue_events_device_hash
  ON venue_events (device_hash);
