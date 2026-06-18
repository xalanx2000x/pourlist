-- Migration 009: Rename address_backup → address
--
-- The original `address` column (NOT NULL on the original schema) was
-- retired in an earlier schema change. The comment in src/lib/supabase.ts
-- said "address removed - see address_backup" — that was accurate. All
-- venue addresses — the 17 seed venues from seed-data-insert.sql plus
-- all user-typed ones — have been living in `address_backup`.
--
-- This migration just renames `address_backup` to the final canonical
-- name `address`. The rename is atomic and preserves data. The
-- `address_normalized` column (added in a later migration, never
-- populated, never read) is left in place for now and dropped in
-- migration 011 (commit 4).
--
-- Note: this migration is SIMPLER than originally planned because
-- there is no `address_seed_legacy` holding column — the original
-- `address` column was already gone in production before this work
-- started, so there was no orphan data to preserve.

ALTER TABLE venues RENAME COLUMN address_backup TO address;
