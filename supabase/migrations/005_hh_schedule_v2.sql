-- ============================================================
-- HAPPY HOUR SCHEDULE MIGRATION v2 — 3 windows + multi-day
-- Run in Supabase SQL Editor
-- https://supabase.com/dashboard/project/cuzkquenafzebdqbuwfk/sql-editor
-- ============================================================
-- Copy everything below and paste into the SQL Editor, then Run
-- ============================================================

-- 1. Change hh_day → hh_days (TEXT for comma-separated ISO weekdays)
ALTER TABLE venues ADD COLUMN hh_days TEXT;
ALTER TABLE venues ADD COLUMN hh_days_2 TEXT;
ALTER TABLE venues ADD COLUMN hh_days_3 TEXT;

-- 2. Day exclusion fields (e.g. "daily except Tue" = hh_days="1,2,3,4,5,6,7", hh_exclude_days="3")
ALTER TABLE venues ADD COLUMN hh_exclude_days TEXT;
ALTER TABLE venues ADD COLUMN hh_exclude_days_2 TEXT;
ALTER TABLE venues ADD COLUMN hh_exclude_days_3 TEXT;

-- 3. Third window
ALTER TABLE venues ADD COLUMN hh_type_3 TEXT;
ALTER TABLE venues ADD COLUMN hh_start_3 INTEGER;
ALTER TABLE venues ADD COLUMN hh_end_3 INTEGER;

-- 4. Venue opening time (minutes since midnight; null = use city default from bar-close-times.ts)
ALTER TABLE venues ADD COLUMN opening_min INTEGER;

-- 5. Backfill: promote existing hh_day int values → hh_days TEXT
UPDATE venues SET hh_days = hh_day::TEXT WHERE hh_day IS NOT NULL;
UPDATE venues SET hh_days_2 = hh_day_2::TEXT WHERE hh_day_2 IS NOT NULL;

SELECT 'HH schedule v2 migration complete' AS result;