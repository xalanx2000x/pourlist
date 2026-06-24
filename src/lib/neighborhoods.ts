/**
 * Shared threshold logic for neighborhood landing pages.
 * Used by:
 *   - /[state]/[city]/[neighborhood] route (Phase C)
 *   - sitemap.ts (Phase D)
 *
 * ONE source of truth — never hardcode the threshold or the venue-count
 * query in more than one place.
 */
import { supabaseServer } from '@/lib/supabase-server'
import { hasHappyHourData } from '@/lib/happy-hour-data'

export const NEIGHBORHOOD_THRESHOLD = 15

export interface NeighborhoodStats {
  neighborhood: string
  venueCount: number
  qualifies: boolean
}

/**
 * Returns all neighborhoods in a given city+state that have ≥1 real venue
 * with HH data, annotated with whether they cross NEIGHBORHOOD_THRESHOLD.
 *
 * Callers filter on .qualifies as needed.
 */
export async function getNeighborhoodStats(
  city: string,
  state: string
): Promise<NeighborhoodStats[]> {
  const { data } = await supabaseServer
    .from('venues')
    .select('neighborhood')
    .not('neighborhood', 'is', null)
    .eq('city', city)
    .eq('state', state)
    .eq('is_seed_data', false)
    .not('hh_type', 'is', null) // must have HH data to count

  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const n = row.neighborhood?.trim()
    if (!n) continue
    counts[n] = (counts[n] ?? 0) + 1
  }

  return Object.entries(counts)
    .map(([neighborhood, venueCount]) => ({
      neighborhood,
      venueCount,
      qualifies: venueCount >= NEIGHBORHOOD_THRESHOLD,
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
