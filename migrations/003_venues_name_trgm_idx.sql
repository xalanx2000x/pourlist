-- 003_venues_name_trgm_idx.sql
--
-- GIN trigram index on venues.name for fast substring search.
--
-- Why: the SearchBar calls ilike('name', '%query%') on every keystroke
-- (debounced 500ms). Without this index, Postgres does a sequential scan
-- over all 59K venues — measured ~2.4s on a service-role query for a
-- 304-row match. With the trigram index, the same query plans to an
-- index scan and falls to <50ms.
--
-- Why not a regular B-tree on lower(name): a B-tree can only accelerate
-- prefix matches (LIKE 'foo%'). The SearchBar does leading-wildcard
-- substring matches (ILIKE '%foo%') so we need pg_trgm's gin_trgm_ops.
--
-- Why not tsvector full-text: venue names don't need stemming or
-- ranking — substring match is the correct semantic. Trigram is simpler
-- and matches the query exactly.
--
-- Apply in Supabase SQL Editor:
--   1. Paste and run the statements below
--   2. Wait for "CREATE INDEX" — typically <30s on 59K rows
--
-- pg_trgm is a trusted-language extension on Supabase, so the
-- `create extension` line below enables it inline. No separate
-- dashboard step is needed (verified against Supabase docs).
--
-- If pg_trgm is restricted in your Supabase project's plan, you'd see:
--   ERROR: permission denied to create extension "pg_trgm"
--   HINT: Must be superuser to create this extension.
-- On hosted Supabase (free/pro) this works directly. On self-hosted
-- or restricted orgs, enable pg_trgm from the Dashboard:
--   Database → Extensions → search "pg_trgm" → Enable.

create extension if not exists pg_trgm;

create index if not exists venues_name_trgm_idx
  on venues using gin (name gin_trgm_ops);

-- Sanity check: confirm the planner will use the index for a leading-
-- wildcard search. Run after applying:
--
--   explain analyze
--   select id, name from venues where name ilike '%AJ%' limit 10;
--
-- Look for "Bitmap Heap Scan on venues" or "Index Scan using
-- venues_name_trgm_idx" in the plan. If you see "Seq Scan", the index
-- isn't being used — investigate selectivity or ANALYZE the table.
analyze venues;