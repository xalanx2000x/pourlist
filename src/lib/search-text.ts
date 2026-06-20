/**
 * normalizeForSearch(s) — single source of truth for search matching.
 *
 * Produces the canonical form of a string used for venue name search.
 * The SQL migration `004_venues_search_name.sql` computes the exact same
 * form into the `venues.search_name` generated column. Any change here
 * MUST be mirrored in the SQL — drift means silent misses in prod.
 *
 * Rule (defined once, used by SQL and TS):
 *   1. lowercase
 *   2. apostrophes (', ', `, U+2019) → removed
 *   3. periods → removed
 *   4. '&' → space (separator, not "and")
 *   5. non-alphanumeric → removed
 *   6. drop stopwords (and, the, a, an) — token-level
 *   7. collapse whitespace
 *   8. trim
 *
 * FALLBACK: if the trimmed result is empty (e.g. a name that's all
 * stopwords or punctuation), return the lowercased raw input. An
 * empty search key would match every query as a substring — same
 * guard as the SQL COALESCE.
 *
 * Examples:
 *   "AJ's Hideaway Bar"    → "ajs hideaway bar"
 *   "Barrel & Vine"        → "barrel vine"
 *   "Barrel and Vine"      → "barrel vine"
 *   "St. John"             → "st john"
 *   "AJs" / "AJ's" / "ajs" → "ajs"
 *   "And"                  → "and"     (fallback — was empty after stopword strip)
 *   "..."                  → "..."     (fallback)
 */

const STOPWORDS = new Set(['and', 'the', 'a', 'an'])

export function normalizeForSearch(s: string | null | undefined): string {
  if (!s) return ''

  const stripped = s
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\b(?:and|the|a|an)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Mirrors the SQL COALESCE — empty normalization would match every
  // query as a substring. Fall back to lowercased raw input.
  return stripped || s.toLowerCase().trim()
}