/**
 * Slug helpers for venue URLs.
 *
 * Format: <slugified-name>-<first-N-chars-of-uuid>
 * Example: "Aalto Lounge" + id "c83100ac-..." → "aalto-lounge-c83100"
 *
 * Slugs are stored in the DB (`venues.slug`) so they're stable when names
 * change. These helpers are the source of truth for both the backfill
 * (one-time migration) and the runtime fallback (if a row's slug is null
 * because the backfill missed it, e.g. a venue added after migration).
 */

/**
 * Convert a venue name to a URL-safe slug fragment.
 * - Lowercase
 * - Strip diacritics
 * - Non-alphanumeric → hyphen
 * - Collapse repeated hyphens
 * - Trim leading/trailing hyphens
 *
 * Returns 'venue' if the result would be empty (e.g. name was all punctuation).
 */
export function slugifyName(name: string): string {
  const cleaned = (name ?? '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/['\u2018\u2019\u2018\u2019]/g, '') // strip apostrophes/curly quotes entirely
    .replace(/[^a-z0-9]+/g, '-')  // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '')       // trim leading/trailing hyphens
  return cleaned || 'venue'
}

/**
 * Short suffix from a UUID. Strips the dashes first, then takes the
 * first `len` hex chars. Default 6 (per spec); longer on collision.
 */
export function uuidShort(id: string, len: number = 6): string {
  return id.replace(/-/g, '').slice(0, len)
}

/**
 * Build a candidate slug for a venue. `existingSlugs` is the set of
 * slugs already taken in the DB; we walk the suffix length upward
 * (6 → 8 → 12 → 16 → 32) until we find an unused candidate.
 *
 * This is collision-safe for any name + id combination.
 */
export function generateVenueSlug(
  venue: { name: string | null; id: string },
  existingSlugs: Set<string>
): string {
  const base = slugifyName(venue.name ?? '')
  for (const len of [6, 8, 12, 16, 32]) {
    const candidate = `${base}-${uuidShort(venue.id, len)}`
    if (!existingSlugs.has(candidate)) return candidate
  }
  // Pathological case: full UUID already collides. Extremely unlikely.
  return `${base}-${venue.id}`
}

/**
 * Resolve a venue to its URL slug at render time.
 * - If `venue.slug` is set, use it (the stable stored value).
 * - Otherwise compute on the fly (fallback for venues that slipped
 *   through the backfill or were added after the migration ran).
 *
 * Note: the computed fallback is *not* persisted, so if a name changes
 * later the slug for a fallback venue will change. The pre-render path
 * (`generateStaticParams` in the venue page) only lists venues with a
 * stored slug, so a fallback only affects the first request to a new
 * on-demand route — and that gets cached by ISR.
 */
export function venueSlug(venue: { slug: string | null; name: string | null; id: string }): string {
  if (venue.slug && venue.slug.trim().length > 0) return venue.slug
  return `${slugifyName(venue.name ?? '')}-${uuidShort(venue.id, 6)}`
}
