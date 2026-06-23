/**
 * Slug helpers for venue URLs.
 *
 * New SEO-friendly URL structure (Phase 1+):
 *   /{stateCode}/{citySlug}/{venueSlug}
 *   Example: /ca/los-angeles/clydes-prime-rib
 *
 * State: 2-letter lowercase ISO code (ca, or, ny)
 * City:  full name, lowercase, hyphenated, apostrophes + diacritics stripped
 * Venue: name only (city/state already in path), same normalization
 *
 * Uniqueness is scoped per-city (two "Clyde's" in different cities → both /ca/los-angeles/clydes;
 * two in the same city → clydes and clydes-2).
 *
 * Slugs are stored in `venues.new_slug` so they're stable when names change.
 * The `needs_geo_review` flag marks venues with ambiguous/missing geo data.
 */

/**
 * Convert a venue name to a URL-safe slug fragment.
 * - Lowercase
 * - Strip diacritics (NFKD normalization + combining-mark strip)
 * - Strip apostrophes and curly quotes entirely (possessives collapse cleanly)
 * - Non-alphanumeric runs → single hyphen
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
    .replace(/['\u2018\u2019\u2018\u2019]/g, '') // strip all quote characters entirely
    .replace(/[^a-z0-9]+/g, '-')  // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '')       // trim leading/trailing hyphens
  return cleaned || 'venue'
}

/**
 * Convert a city name to a URL-safe slug segment.
 * Uses the same rules as slugifyName — same normalization, same strip behavior.
 * Deterministic: same input always → same output.
 */
export function slugifyCity(city: string | null): string {
  return slugifyName(city ?? '')
}

/**
 * Short suffix from a UUID. Strips the dashes first, then takes the
 * first `len` hex chars. Default 6 (per spec); longer on collision.
 */
export function uuidShort(id: string, len: number = 6): string {
  return id.replace(/-/g, '').slice(0, len)
}

/**
 * Build a candidate slug for a venue. `existingInCity` is the set of
 * venue-slug fragments already taken in that city; we walk the suffix
 * upward (-2 → -3 → -4) until we find an unused candidate.
 */
function uniqueInCity(venueSlug: string, existingInCity: Set<string>): string {
  if (!existingInCity.has(venueSlug)) return venueSlug
  for (let i = 2; i <= 99; i++) {
    const candidate = `${venueSlug}-${i}`
    if (!existingInCity.has(candidate)) return candidate
  }
  // Pathological: 99+ duplicates in one city. Extremely unlikely.
  return `${venueSlug}-${Date.now()}`
}

/**
 * Resolve a venue to its NEW-FORMAT SEO URL path.
 *
 * Returns { path, needsGeoReview, fallbackPath } where:
 * - path: the full /{state}/{city}/{slug} path (if geo data is complete)
 * - needsGeoReview: true if state or city is missing/ambiguous
 * - fallbackPath: a usable URL path even if geo is incomplete (for the redirect chain)
 *
 * Calls Supabase to check per-city slug uniqueness. Gracefully degrades:
 * if the `new_slug` / `needs_geo_review` columns don't exist yet, returns
 * a safe fallback without throwing.
 */
export async function resolveNewSlug(
  venue: {
    id: string
    name: string | null
    city: string | null
    state: string | null
  },
  supabase: import('@supabase/supabase-js').SupabaseClient<any, any>
): Promise<{ path: string; needsGeoReview: boolean; fallbackPath: string }> {
  const venueSlug = slugifyName(venue.name ?? '')
  const stateCode = (venue.state ?? '').toLowerCase().trim()
  const cityRaw = venue.city ?? ''
  const citySlug = slugifyCity(cityRaw)

  // Determine if geo data is adequate for the new URL structure
  const hasState = stateCode.length === 2
  const hasCity = cityRaw.trim().length > 0
  const needsGeoReview = !hasState || !hasCity

  // Build the path segments
  const stateSegment = hasState ? stateCode : 'unknown'
  const citySegment = hasCity ? citySlug : 'unknown-city'

  // Query existing slugs in the same city (if city is known)
  let existingInCity = new Set<string>()
  if (hasCity && hasState) {
    try {
      const { data } = await supabase
        .from('venues')
        .select('new_slug')
        .eq('state', venue.state)
        .ilike('new_slug', `${stateSegment}/${citySegment}/%`)
      existingInCity = new Set(
        (data ?? [])
          .map((r: any) => {
            const parts = r.new_slug?.split('/')
            return parts?.[2] ?? null // venue-slug is 3rd segment
          })
          .filter(Boolean) as string[]
      )
    } catch {
      // Column doesn't exist yet (migration not applied) — skip uniqueness check
      existingInCity = new Set()
    }
  }

  const uniqueSlug = uniqueInCity(venueSlug, existingInCity)
  const fullPath = `/${stateSegment}/${citySegment}/${uniqueSlug}`
  const fallbackPath = `/${stateSegment}/${citySegment}/${uniqueSlug}`

  return {
    path: needsGeoReview ? fallbackPath : fullPath,
    needsGeoReview,
    fallbackPath,
  }
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
 * Resolve a venue to its URL slug at render time (OLD format, for backward compat).
 * - If `venue.slug` is set, use it (the stable stored value).
 * - Otherwise compute on the fly (fallback for venues that slipped through backfill).
 */
export function venueSlug(venue: { slug: string | null; name: string | null; id: string }): string {
  if (venue.slug && venue.slug.trim().length > 0) return venue.slug
  return `${slugifyName(venue.name ?? '')}-${uuidShort(venue.id, 6)}`
}
