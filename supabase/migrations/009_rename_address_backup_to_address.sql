-- Migration 009: Rename address_backup → address
--
-- Pre-migration state:
--   - venues.address        TEXT NOT NULL  (seed-data column, NOT NULL on the 59K)
--   - venues.address_backup TEXT            (user-typed, what 15+ read sites actually use)
--
-- Post-migration state:
--   - venues.address_seed_legacy TEXT NOT NULL  (the old seed column, renamed to hold its data)
--   - venues.address             TEXT            (the renamed address_backup, now canonical)
--
-- The old seed column is renamed (not dropped) so the data is still queryable for
-- verification until the final cleanup migration (011) drops it.

-- 1. Rename old seed column to a holding name. Preserves its data under a
--    different name so we can verify the copy in step 3 worked.
ALTER TABLE venues RENAME COLUMN address TO address_seed_legacy;

-- 2. Promote address_backup to be the canonical display column. After this
--    statement, venues.address is what every read site in src/ queries.
ALTER TABLE venues RENAME COLUMN address_backup TO address;

-- 3. For venues that only had an address in the old seed column (i.e. the
--    59K seed venues where address_backup was never populated), copy the
--    legacy value into the new column. Only fills where the new column is
--    empty (NULL or ''), so any user-typed value in address_backup wins.
UPDATE venues
SET address = address_seed_legacy
WHERE address_seed_legacy IS NOT NULL
  AND (address IS NULL OR address = '');
