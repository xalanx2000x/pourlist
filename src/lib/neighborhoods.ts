/**
 * Shared threshold logic for neighborhood landing pages.
 * Used by:
 *   - /[state]/[city]/[neighborhood] route ([city]/[slug]/page.tsx)
 *   - /[state]/[city]/page.tsx (via getQualifyingNeighborhoods)
 *   - sitemap.ts
 *
 * ONE source of truth — never hardcode the threshold or the venue-count
 * query in more than one place.
 *
 * IMPORTANT: Must stay in sync with getNeighborhoodPage in
 * src/app/[state]/[city]/[slug]/page.tsx — both use fetchQualifyingVenues.
 */
import { supabaseServer } from '@/lib/supabase-server'
import { slugifyName } from '@/lib/slug'

export const NEIGHBORHOOD_PAGE_THRESHOLD = 10

// Columns needed for neighborhood qualification check
const QUALIFYING_COLS = [
  'id', 'name', 'slug', 'new_slug', 'neighborhood', 'city', 'state', 'status',
  'is_seed_data', 'last_verified', 'created_at',
  'hh_type', 'hh_time', 'hh_days', 'hh_exclude_days', 'hh_start', 'hh_end',
  'hh_type_2', 'hh_days_2', 'hh_exclude_days_2', 'hh_start_2', 'hh_end_2',
  'hh_type_3', 'hh_days_3', 'hh_exclude_days_3', 'hh_start_3', 'hh_end_3',
  'opening_min', 'timezone', 'lat', 'lng',
].join(', ')

/**
 * Shared venue fetch for neighborhood pages.
 * Applies slug-safe matching for both city and neighborhood dimensions.
 * Used by getNeighborhoodStats (here) AND getNeighborhoodPage in [city]/[slug]/page.tsx.
 * Must produce identical result sets — any change here must be reflected there.
 */
export async function fetchQualifyingVenues(
  state: string,
  citySlug: string,
  neighborhoodSlug: string
) {
  const { data } = await supabaseServer
    .from('venues')
    .select(QUALIFYING_COLS)
    .eq('state', state.toUpperCase())
    .eq('is_seed_data', false)
    .in('status', ['verified', 'stale'])
    .not('hh_type', 'is', null)
    .not('neighborhood', 'is', null)

  if (!data) return []

  // Slug-safe match: same slugifyName used to build URLs
  return (data as any[]).filter(v => {
    return slugifyName(v.city ?? '') === citySlug
      && slugifyName(v.neighborhood ?? '') === neighborhoodSlug
  })
}

export interface NeighborhoodStats {
  neighborhood: string
  venueCount: number
  qualifies: boolean
}

/**
 * Returns all neighborhoods in a given city+state that have ≥1 real venue
 * with HH data, annotated with whether they cross NEIGHBORHOOD_PAGE_THRESHOLD.
 *
 * Callers filter on .qualifies as needed.
 */
export async function getNeighborhoodStats(
  city: string,
  state: string
): Promise<NeighborhoodStats[]> {
  // Must stay in sync with getNeighborhoodPage in
  // src/app/[state]/[city]/[slug]/page.tsx — both call fetchQualifyingVenues.
  const citySlug = slugifyName(city)
  const { data: allVenues } = await supabaseServer
    .from('venues')
    .select('neighborhood, city')
    .eq('state', state.toUpperCase())
    .eq('is_seed_data', false)
    .in('status', ['verified', 'stale'])
    .not('hh_type', 'is', null)
    .not('neighborhood', 'is', null)

  if (!allVenues) return []

  // Slug-safe match for city dimension
  const matching = (allVenues as any[]).filter(v => slugifyName(v.city ?? '') === citySlug)

  const counts: Record<string, number> = {}
  for (const row of matching) {
    const n = row.neighborhood?.trim()
    if (!n) continue
    counts[n] = (counts[n] ?? 0) + 1
  }

  return Object.entries(counts)
    .map(([neighborhood, venueCount]) => ({
      neighborhood,
      venueCount,
      qualifies: venueCount >= NEIGHBORHOOD_PAGE_THRESHOLD,
    }))
    .sort((a, b) => b.venueCount - a.venueCount) // descending
}

/**
 * Returns neighborhoods that qualify for a public landing page (≥threshold).
 */
export async function getQualifyingNeighborhoods(
  city: string,
  state: string
): Promise<NeighborhoodStats[]> {
  const all = await getNeighborhoodStats(city, state)
  return all.filter(n => n.qualifies)
}

/**
 * Returns true if a given neighborhood has a public landing page (meets threshold).
 * Used by venue pages to render a neighborhood breadcrumb link.
 */
export async function neighborhoodQualifies(
  neighborhood: string,
  city: string,
  state: string
): Promise<boolean> {
  const stats = await getNeighborhoodStats(city, state)
  const found = stats.find(n => n.neighborhood === neighborhood)
  return found?.qualifies ?? false
}
