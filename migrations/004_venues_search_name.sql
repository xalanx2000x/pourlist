-- 004_venues_search_name.sql
--
-- Normalized search_name column + dedicated trigram index.
--
-- Why: the SearchBar needs to match venue names case- AND punctuation-
-- insensitively. Users type "ajs", "AJ's", "AJs" — all should find
-- "AJ's Hideaway Bar". Users type "barrel vine" — should find
-- "Barrel & Vine". The raw `name` column with `ilike` can't do this
-- because the literal characters differ ('s' vs "'s", '&' vs ' and ').
--
-- A trigram index on the normalized form is the canonical Postgres
-- pattern for fast substring search over arbitrary input. Computing
-- the normalization once at write time (GENERATED column) keeps the
-- index hot AND the query plan simple.
--
-- Why not query-side normalization: any function call over `name`
-- (lower, regexp_replace, etc.) per row defeats the trigram index.
-- The whole point of `venues_name_trgm_idx` is to be searched with
-- a single ILIKE — so we put the normalized form in its own column.
--
-- Single source of truth: the normalization rule is mirrored in
-- src/lib/search-text.ts. The TS helper produces byte-identical
-- output to the SQL expression for any input string. Drift between
-- the two means silent misses in prod — so keep them in sync.
--
-- Normalization rule (defined once, used by SQL and TS):
--   1. lowercase
--   2. apostrophes (', ', `, U+2019) → removed
--   3. periods → removed
--   4. '&' → space (separator, not "and" — makes "barrel vine"
--      match "Barrel & Vine")
--   5. non-alphanumeric → removed
--   6. drop stopwords (and, the, a, an) — token-level
--   7. collapse whitespace
--   8. trim
--   FALLBACK: if the result of steps 1–8 is empty (e.g. a name that's
--   all stopwords or punctuation), use lower(name) instead — an empty
--   search_name would match every query as a substring.
--
-- GENERATED ALWAYS AS ... STORED recomputes automatically when
-- `name` changes. Standard Postgres 12+ behavior, no trigger needed.
--
-- Apply in Supabase SQL Editor:
--   1. Paste and run the statements below
--   2. Wait for "CREATE INDEX" — typically <30s on 59K rows
--   3. (Optional) sanity check:
--        SELECT name, search_name FROM venues WHERE name ILIKE '%aj%' LIMIT 5;

alter table venues
  add column search_name text
  generated always as (
    coalesce(
      nullif(
        trim(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(lower(name), '&', ' ', 'g'),
                '[^a-z0-9 ]', '', 'g'),
              '\band\b|\bthe\b|\ba\b|\ban\b', '', 'g'),
            '\s+', ' ', 'g')
        ),
        ''),
      lower(name)
    )
  ) stored;

create index venues_search_name_trgm_idx
  on venues using gin (search_name gin_trgm_ops);

-- Old `venues_name_trgm_idx` (on raw `name`) becomes dead weight now
-- that search uses `search_name`. NOT dropped in this migration per
-- staging preference — verify the new path works first, drop the old
-- index in a trivial follow-up.

analyze venues;