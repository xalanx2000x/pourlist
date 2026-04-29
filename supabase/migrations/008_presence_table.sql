-- Lightweight presence table: tracks when devices were last active
-- Used for "online now" count on devdash
CREATE TABLE IF NOT EXISTS presence (
  device_hash TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  last_seen TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Fast lookup: "how many devices seen in last 5 minutes"
CREATE INDEX IF NOT EXISTS idx_presence_last_seen ON presence(last_seen DESC);

-- Fast upsert support
CREATE INDEX IF NOT EXISTS idx_presence_device_hash ON presence(device_hash);
