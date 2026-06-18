-- Migration 010: Add structured address fields
--
-- After commit 1, venues.address is the single display string. This
-- migration adds the structured fields that become the canonical
-- source of truth for user-contributed venues going forward:
--
--   street          TEXT  best-effort street from reverse-geocode
--   city            TEXT  high-confidence (e.g. "Portland")
--   state           TEXT  high-confidence 2-letter ISO code (e.g. "OR")
--   neighborhood    TEXT  high-confidence (e.g. "Pearl District")
--   country         TEXT  high-confidence 2-letter ISO code (e.g. "US")
--   address_autofilled BOOLEAN  provenance flag; true when the
--                              new-contribution hook filled the address
--                              from GPS via reverse-geocode
--
-- Existing seed venues have all these fields NULL (they were curated
-- by a human, not autofilled). The display helper formatAddress()
-- detects autofilled=false and returns venues.address (the stored
-- string) untouched, so seed venues continue to render their existing
-- address text.
--
-- zip was added in the original schema; not duplicated here.

ALTER TABLE venues
  ADD COLUMN IF NOT EXISTS street             TEXT,
  ADD COLUMN IF NOT EXISTS city               TEXT,
  ADD COLUMN IF NOT EXISTS state              TEXT,
  ADD COLUMN IF NOT EXISTS neighborhood       TEXT,
  ADD COLUMN IF NOT EXISTS country            TEXT,
  ADD COLUMN IF NOT EXISTS address_autofilled BOOLEAN DEFAULT FALSE;
