-- Migration 018: claim_requests table for venue ownership interest
-- RLS: no public read; inserts only via API route using service role key

CREATE TABLE IF NOT EXISTS claim_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id     UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
  contact_name TEXT NOT NULL,
  phone        TEXT NOT NULL,
  email        TEXT NOT NULL,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for the spam-guard query (same venue, last 24h)
CREATE INDEX IF NOT EXISTS idx_claim_requests_venue_created
  ON claim_requests(venue_id, created_at DESC);

COMMENT ON TABLE claim_requests IS
  'Venue ownership inquiry submissions. No public read. Inserts only via /api/claim-request.';
