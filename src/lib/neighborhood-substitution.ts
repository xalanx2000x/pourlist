/**
 * neighborhood-substitution.ts
 *
 * Translates raw Mapbox neighborhood names to human-readable display names
 * using the neighborhood_map table. The raw value is preserved in
 * venues.neighborhood_raw as an immutable rollback/escape-hatch.
 *
 * Used at write time by /seed venue handlers (handleNew, handleEdit, handleGeocode).
 * The rest of the codebase reads venues.neighborhood directly — no query-time
 * join needed.
 */
import { createClient } from '@supabase/supabase-js'

const supabaseMap = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Looks up display_name via zone polygon (if lat/lng provided and a zone matches),
 * then via neighborhood_map text table, then returns raw name unchanged.
 * The raw value is preserved in venues.neighborhood_raw as an immutable rollback.
 */
export async function substituteNeighborhood(
  city: string | null,
  state: string | null,
  rawNeighborhood: string | null,
  lat?: number | null,
  lng?: number | null,
): Promise<string | null> {
  // 1. Zone polygon lookup (takes precedence)
  if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
    const { data: zoneName } = await supabaseMap.rpc('find_zone_by_point', {
      p_lat: lat,
      p_lng: lng,
    })
    if (typeof zoneName === 'string' && zoneName.length > 0) {
      return zoneName
    }
  }

  // 2. Text mapping fallback
  if (!rawNeighborhood) return rawNeighborhood
  if (!city || !state) return rawNeighborhood

  const { data } = await supabaseMap
    .from('neighborhood_map')
    .select('display_name')
    .eq('city', city)
    .eq('state', state)
    .eq('mapbox_neighborhood', rawNeighborhood)
    .maybeSingle()

  return data?.display_name ?? rawNeighborhood
}
