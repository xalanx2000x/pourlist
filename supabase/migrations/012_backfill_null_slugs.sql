-- 012_backfill_null_slugs.sql
-- Forward-only: only updates venues that currently have slug=NULL.
-- Does NOT touch venues with existing stored slugs — their URLs are stable and must not change.
--
-- Slugs generated using the same name→slug algorithm as the runtime:
--   slugifyName(name) + '-' + first-6-chars-of-uuid (hex, no dashes)
--
-- Apostrophes are stripped in slugifyName, so:
--   "Finns Fish House" → "finns-fish-house-3ad796"
--   "Bar West"         → "bar-west-bc304d"

UPDATE venues
SET slug = 'finns-fish-house-' || SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 6)
WHERE slug IS NULL
  AND name = 'Finns Fish House'
  AND id = '3ad79671-b09e-487b-b434-76caa177cd1f';

UPDATE venues
SET slug = 'bar-west-' || SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 6)
WHERE slug IS NULL
  AND name = 'Bar West'
  AND id = 'bc304d6e-d905-4817-ab4e-36c5dac1671a';
