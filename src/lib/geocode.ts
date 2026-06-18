import { supabase } from './supabase'
import type { Venue } from './supabase'

export type GeoResult = {
  displayName: string
  state?: string
  country?: string
  lat: number
  lng: number
}

export type SearchResult =
  | { type: 'venues'; venues: Venue[] }
  | { type: 'geo'; geo: GeoResult }
  | { type: 'none' }

export async function searchVenues(query: string): Promise<SearchResult> {
  const trimmed = query.trim()
  if (!trimmed) return { type: 'none' }

  // Search Supabase for venues matching the name
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, address, lat, lng, latest_menu_image_url, hh_time, status')
    .eq('is_seed_data', false)
    .ilike('name', `%${trimmed}%`)
    .limit(5)

  // Fall back: strip punctuation and try again (handles "QD's"↔"QDS", "O'Brien"↔"OBrien", etc.)
  if ((!venues || venues.length === 0) && trimmed.length >= 2) {
    const normalized = trimmed.replace(/[^a-zA-Z0-9]/g, '')
    if (normalized !== trimmed) {
      const { data: venues2 } = await supabase
        .from('venues')
        .select('id, name, address, lat, lng, latest_menu_image_url, hh_time, status')
        .eq('is_seed_data', false)
        .ilike('name', `%${normalized}%`)
        .limit(5)
      if (venues2 && venues2.length > 0) {
        return { type: 'venues', venues: venues2 as Venue[] }
      }
    }
  }

  if (venues && venues.length > 0) {
    return { type: 'venues', venues: venues as Venue[] }
  }

  // No venue match — fall back to Nominatim for geographic search
  const geo = await geocodeWithNominatim(trimmed)
  if (geo) return { type: 'geo', geo }

  return { type: 'none' }
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
