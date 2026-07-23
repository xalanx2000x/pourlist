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
 * Looks up display_name in neighborhood_map.
 * Returns the raw neighborhood name unchanged if no mapping exists.
 */
export async function substituteNeighborhood(
  city: string | null,
  state: string | null,
  rawNeighborhood: string | null
): Promise<string | null> {
  if (!rawNeighborhood) return rawNeighborhood
  if (!city || !state) return rawNeighborhood

  const cityStr = city as string
  const stateStr = state as string

  const { data } = await supabaseMap
    .from('neighborhood_map')
    .select('display_name')
    .eq('city', cityStr)
    .eq('state', stateStr)
    .eq('mapbox_neighborhood', rawNeighborhood)
    .maybeSingle()

  return data?.display_name ?? rawNeighborhood
}
