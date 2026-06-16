-- Add slug column to venues for SEO-friendly URL paths (/venue/[slug]).
-- Slugs are stable identifiers derived from the venue name + a short
-- uuid suffix. The backfill script (scripts/backfill-venue-slugs.ts)
-- populates this column. Slug is nullable to allow safe re-runs.

alter table venues add column if not exists slug text;

-- Unique index so /venue/[slug] resolution is unambiguous and Postgres
-- can serve the row in O(log n) without a full table scan.
create unique index if not exists venues_slug_unique_idx
  on venues(slug)
  where slug is not null;
