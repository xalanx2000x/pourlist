import { supabase } from './supabase'
import type { Venue } from './supabase'
import { hasHappyHourData } from './happy-hour-data'
import { normalizeForSearch } from './search-text'

export type GeoResult = {
  displayName: string
  state?: string
  country?: string
  lat: number
  lng: number
}

/**
 * SearchResult: always returns BOTH venues and geo. Either may be empty.
 * The caller renders one dropdown with two labeled sections — never an
 * empty "no results" if either side has anything to show.
 *
 * Venue results are ranked verified-first (hasHappyHourData) and capped
 * at VENUE_LIMIT. The geo section is capped at 1 (Nominatim returns 1).
 */
export type SearchResult = {
  venues: Venue[]
  geo: GeoResult | null
}

const VENUE_LIMIT = 5

// Fields needed by the dropdown — includes hh_type/menu_text/hh_summary
// so hasHappyHourData() works on the result client-side without a
// second query.
const VENUE_SELECT =
  'id, name, slug, address, city, state, neighborhood, country, zip, address_autofilled, lat, lng, hh_type, hh_days, hh_exclude_days, hh_start, hh_end, hh_time, status, is_seed_data, type, latest_menu_image_url, menu_text, hh_summary'

export async function searchVenues(query: string): Promise<SearchResult> {
  const trimmed = query.trim()
  if (!trimmed) return { venues: [], geo: null }

  // Run both queries in parallel. Each is independent; Nominatim is the
  // slow one and shouldn't block the venue result.
  const [venues, geo] = await Promise.all([
    searchVenueMatches(trimmed),
    geocodeWithNominatim(trimmed),
  ])

  return { venues, geo }
}

/**
 * Venue search by normalized name. Returns up to VENUE_LIMIT venues
 * ranked verified-first (venues with happy-hour data bubble up;
 * unverified venues fill the rest). No seed filter — all venues are
 * searchable; unverified seed venues show as contribution invitations.
 *
 * Both the query and the `venues.search_name` column are normalized
 * via `normalizeForSearch()` (single source of truth, mirrored in the
 * SQL that generated the column). This is what makes "ajs", "AJs",
 * and "AJ's" all match "AJ's Hideaway Bar" — and what makes "barrel
 * vine" match "Barrel & Vine".
 */
async function searchVenueMatches(query: string): Promise<Venue[]> {
  // Fetch more than the cap so we can rank + cut in JS without
  // needing a SQL CASE expression. The trigram index on `search_name`
  // keeps the ILIKE cheap; VENUE_FETCH is the candidate pool, not the cap.
  const VENUE_FETCH = 30

  const normalizedQuery = normalizeForSearch(query)
  if (!normalizedQuery) return []

  const { data } = await supabase
    .from('venues')
    .select(VENUE_SELECT)
    .ilike('search_name', `%${normalizedQuery}%`)
    .limit(VENUE_FETCH)

  if (!data || data.length === 0) return []

  // Rank: verified venues first (hasHappyHourData), then by name.
  const ranked = (data as Venue[]).slice().sort((a, b) => {
    const aH = hasHappyHourData(a) ? 0 : 1
    const bH = hasHappyHourData(b) ? 0 : 1
    if (aH !== bH) return aH - bH
    return (a.name ?? '').localeCompare(b.name ?? '')
  })

  return ranked.slice(0, VENUE_LIMIT)
}

async function geocodeWithNominatim(query: string): Promise<GeoResult | null> {
  const searchQuery = `${query.trim()}, USA`

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', searchQuery)
  url.searchParams.set('format', 'json')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', '1')

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'PourList/1.0 (contact@pourlist.app)',
      },
    })

    if (!res.ok) {
      console.error('Nominatim geocode error:', res.status, await res.text())
      return null
    }

    const results = await res.json()
    if (!results || results.length === 0) return null

    const first = results[0]
    const addr = first.address

    // Build a clean display name: "City, ST" or "City, Country"
    const city = addr?.city || addr?.town || addr?.village || addr?.hamlet || addr?.municipality || ''
    const state = addr?.state || ''
    const country = addr?.country_code?.toUpperCase() || addr?.country || ''

    let displayName = city
    if (state) displayName += `, ${state}`
    else if (country) displayName += `, ${country}`

    // Fallback to full display name if no city found
    if (!displayName || displayName === ', ') {
      displayName = first.display_name?.split(',')[0] || query
    }

    return {
      displayName: displayName.trim(),
      state: state || undefined,
      country: country || undefined,
      lat: parseFloat(first.lat),
      lng: parseFloat(first.lon),
    }
  } catch (err) {
    console.error('Nominatim geocode failed:', err)
    return null
  }
}

export async function geocodeAddress(
  address: string
): Promise<{ lat: number; lng: number; zip?: string } | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', `${address}, Portland, OR, USA`)
  url.searchParams.set('format', 'json')
  url.searchParams.set('addressdetails', '1')
  url.searchParams.set('limit', '1')

  try {
    const res = await fetch(url.toString(), {
      headers: {
        'User-Agent': 'PourList/1.0 (contact@pourlist.app)',
      },
    })

    if (!res.ok) return null

    const results = await res.json()
    if (!results || results.length === 0) return null

    const first = results[0]
    const zip =
      first.address?.postcode ||
      first.address?.city?.match(/\d{5}/)?.[0] ||
      undefined

    return {
      lat: parseFloat(first.lat),
      lng: parseFloat(first.lon),
      zip,
    }
  } catch {
    return null
  }
}
