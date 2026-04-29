import { supabase } from './supabase'
import type { Venue } from './supabase'

export async function searchVenues(
  query: string
): Promise<{
  type: 'venues' | 'location'
  venues?: Venue[]
  coords?: { lat: number; lng: number }
}> {
  const trimmed = query.trim()

  // If it's a 5-digit zip, skip venue search and go straight to Nominatim
  if (/^\d{5}$/.test(trimmed)) {
    const coords = await geocodeWithNominatim(trimmed)
    return coords ? { type: 'location', coords } : { type: 'location' }
  }

  // Search Supabase for venues matching the name
  const { data: venues } = await supabase
    .from('venues')
    .select('id, name, address_backup, lat, lng, latest_menu_image_url, hh_time, status')
    .ilike('name', `%${trimmed}%`)
    .limit(5)

  // Fall back: strip punctuation and try again (handles "QD's"↔"QDS", "O'Brien"↔"OBrien", etc.)
  if ((!venues || venues.length === 0) && trimmed.length >= 2) {
    const normalized = trimmed.replace(/[^a-zA-Z0-9]/g, '')
    if (normalized !== trimmed) {
      const { data: venues2 } = await supabase
        .from('venues')
        .select('id, name, address_backup, lat, lng, latest_menu_image_url, hh_time, status')
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

  // No venue match — fall back to Nominatim geocoding
  const coords = await geocodeWithNominatim(trimmed)
  return coords ? { type: 'location', coords } : { type: 'location' }
}

async function geocodeWithNominatim(
  query: string
): Promise<{ lat: number; lng: number } | null> {
  const isZipCode = /^\d{5}$/.test(query.trim())
  const searchQuery = isZipCode ? `${query.trim()}, USA` : query

  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', searchQuery)
  url.searchParams.set('format', 'json')
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
    if (!results || results.length === 0) {
      return null
    }

    const first = results[0]
    return {
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
    // Extract zip from address components
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
