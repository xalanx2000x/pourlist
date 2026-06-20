-- 005_drop_venues_name_trgm_idx.sql
--
-- Cleanup: drop the old trigram index on raw `venues.name`.
--
-- Reason: migration 004 added `venues.search_name` (a normalized
-- generated column) and a dedicated trigram index
-- `venues_search_name_trgm_idx` on it. All search queries now hit
-- `search_name`, so `venues_name_trgm_idx` is dead weight — it
-- indexes `name` for no caller.
--
-- Per staging preference: NOT dropped in 004. Verified the new
-- search_name path works on real queries first (EXPLAIN ANALYZE
-- shows the planner uses venues_search_name_trgm_idx), then
-- dropping the old index in this trivial follow-up keeps the
-- migration history explicit about what changed when.
--
-- Apply in Supabase SQL Editor (single statement, instant):

drop index if exists venues_name_trgm_idx;