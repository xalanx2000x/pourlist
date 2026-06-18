import ExifReader from 'exifreader'
import { isDeepLinkActive } from './deep-link'

/**
 * Thrown by getBrowserLocation when both browser GPS and the IP
 * geolocation fallback have failed — i.e. the user genuinely has no
 * location available (OS-level location off, browser permission
 * denied, no network for IP lookup, etc.). Callers can `instanceof`
 * check this to show a "location's off" hint without confusing it
 * with the deep-link chokepoint rejection.
 */
export class LocationUnavailableError extends Error {
  constructor(message = 'Location unavailable') {
    super(message)
    this.name = 'LocationUnavailableError'
  }
}

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

export interface GpsCoords {
  lat: number
  lng: number
}

/**
 * Extract GPS coordinates from a photo's EXIF data.
 * Returns null if no GPS data is embedded.
 */
export async function extractGpsFromPhoto(file: File): Promise<GpsCoords | null> {
  try {
    const tags = await ExifReader.load(file, { expanded: true })

    if (!tags.gps) return null

    const lat = tags.gps.Latitude
    const lng = tags.gps.Longitude

    if (lat == null || lng == null) return null

    // EXIF stores lat/lng as decimal degrees already
    return { lat, lng }
  } catch {
    return null
  }
}

/**
 * Get browser's current geolocation.
 * 
 * Strategy:
 * 1. Try browser GPS — give it 10s to get a fix
 * 2. If GPS succeeds → return real coordinates (accurate to ~5m)
 * 3. If GPS fails after 10s → fall back to IP geolocation (~500m accuracy in Portland)
 *    BUT: when using IP geolocation, the app uses a wider radius so venues still load.
 *    This is handled in loadVenues, not here — we just return the IP coords.
 * 
 * We deliberately do NOT race GPS vs IP — IP is only used when GPS genuinely can't get a fix.
 * This prevents IP's coarse coordinates from polluting the 200m-radius venue query.
 */
export function getBrowserLocation(): Promise<GpsCoords> {
  return new Promise((resolve, reject) => {
    // Chokepoint: abort if a deep link is active. The deep link owns
    // the map position until the user pans or taps "near me"; a stray
    // location fix from GPS or IP would recenter the map over the
    // shared venue card. All three location sources (GPS success, GPS
    // error → IP fallback, no hardware → IP fallback) flow through
    // here, so gating at this one place covers all of them in one shot.
    if (isDeepLinkActive()) {
      reject(new Error('Deep-link active — location request suppressed'))
      return
    }

    if (!navigator.geolocation) {
      // No GPS hardware — try IP geolocation
      fetchIpLocation().then(resolve).catch(reject)
      return
    }

    let settled = false
    const settle = (coords: GpsCoords | null) => {
      if (settled) return
      settled = true
      if (coords) resolve(coords)
      else fetchIpLocation().then(resolve).catch(reject)
    }

    // Give GPS 10 seconds to resolve before falling back to IP
    const timer = setTimeout(() => settle(null), 10_000)

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer)
        settle({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => {
        clearTimeout(timer)
        settle(null) // Trigger IP fallback
      },
      { timeout: 10_000, maximumAge: 60_000, enableHighAccuracy: true }
    )
  })
}

/**
 * Approximate user location via IP geolocation (free, no API key needed).
 * Used as fallback when browser GPS is unavailable.
 */
async function fetchIpLocation(): Promise<GpsCoords> {
  // Try ipapi.co (free tier, 1000 req/day, no key needed)
  const res = await fetch('https://ipapi.co/json/', { cache: 'no-cache' })
  if (res.ok) {
    const data = await res.json()
    if (data.latitude && data.longitude) {
      return { lat: data.latitude, lng: data.longitude }
    }
  }
  // Fallback: ip-api.com (free, 45 req/min)
  const res2 = await fetch('http://ip-api.com/json/?fields=lat,lon', { cache: 'no-cache' })
  if (res2.ok) {
    const data = await res2.json()
    if (data.lat != null && data.lon != null) {
      return { lat: data.lat, lng: data.lon }
    }
  }
  throw new LocationUnavailableError('IP geolocation failed')
}

/**
 * Reverse geocode coordinates to an address string.
 * Tries Mapbox first (primary), falls back to Nominatim.
 * Returns null if both fail.
 */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  // Primary: Mapbox Geocoding API (100k/month free on this token's plan)
  if (MAPBOX_TOKEN) {
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (data.features?.[0]?.place_name) {
          return data.features[0].place_name
        }
      }
    } catch {
      // Fall through to Nominatim
    }
  }

  // Fallback: Nominatim (OpenStreetMap)
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { 'User-Agent': 'PourList/1.0' } }
    )
    const data = await res.json()
    if (data.display_name) {
      return data.display_name
    }
  } catch {
    // Both failed
  }

  return null
}

/**
 * Structured address returned by reverseGeocodeStructured.
 * All fields can be null if the upstream geocoder didn't return them
 * (e.g. Nominatim fallback for an address Mapbox couldn't parse).
 * `place_name` is the single display string for backwards compat with
 * the old reverseGeocode(); `street` is best-effort (number + name).
 */
export interface StructuredAddress {
  place_name: string
  street: string | null
  city: string | null
  state: string | null
  neighborhood: string | null
  country: string | null
  zip: string | null
}

/**
 * Reverse geocode coordinates into structured fields.
 * Tries Mapbox first (primary), falls back to Nominatim.
 * Returns null if both fail.
 *
 * For Mapbox, the context[] array carries typed entries we parse by
 * `id` prefix:
 *   - place.*        → city
 *   - region.*       → state (via short_code, e.g. "US-OR" → "OR")
 *   - neighborhood.* → neighborhood
 *   - postcode.*     → zip
 *   - country.*      → country (via short_code, e.g. "US" or "CA")
 *
 * For Nominatim, the `address` subobject carries equivalent fields.
 * Less rich than Mapbox (no neighborhood typically) but the basic
 * city/state/country/zip come through.
 *
 * The dash-strip for state/country is generic: "US-OR" → "OR",
 * "CA-BC" → "BC", "MX-CMX" → "CMX". Works for any country, not just US.
 */
export async function reverseGeocodeStructured(
  lat: number,
  lng: number
): Promise<StructuredAddress | null> {
  // Primary: Mapbox
  if (MAPBOX_TOKEN) {
    try {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=address`
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        const feature = data.features?.[0]
        if (feature) {
          return parseMapboxFeature(feature)
        }
      }
    } catch {
      // Fall through to Nominatim
    }
  }

  // Fallback: Nominatim
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { 'User-Agent': 'PourList/1.0' } }
    )
    const data = await res.json()
    if (data) {
      return parseNominatimResult(data)
    }
  } catch {
    // Both failed
  }

  return null
}

function parseMapboxFeature(feature: any): StructuredAddress {
  const place_name: string = feature.place_name || ''
  const text: string = feature.text || '' // e.g. "Northwest Glisan Street"
  const number: string = feature.address || '' // e.g. "1314"

  let city: string | null = null
  let state: string | null = null
  let neighborhood: string | null = null
  let country: string | null = null
  let zip: string | null = null

  for (const c of feature.context || []) {
    const id: string = c.id || ''
    if (id.startsWith('place.')) {
      city = c.text
    } else if (id.startsWith('region.')) {
      // short_code is "US-OR" / "CA-BC" etc. Take what comes after the last dash.
      const code = c.short_code?.split('-').pop()
      state = code || c.text
    } else if (id.startsWith('neighborhood.')) {
      neighborhood = c.text
    } else if (id.startsWith('country.')) {
      // short_code is the ISO 3166-1 alpha-2 code ("US", "CA", etc.)
      country = c.short_code || c.text
    } else if (id.startsWith('postcode.')) {
      zip = c.text
    }
  }

  // Street: number + name. Best-effort — number can be missing (e.g.
  // a park or landmark), and text can be missing if the geocoder
  // didn't break it down. Either or both being empty just yields null.
  const street = number && text ? `${number} ${text}` : null

  return { place_name, street, city, state, neighborhood, country, zip }
}

function parseNominatimResult(data: any): StructuredAddress {
  const place_name: string = data.display_name || ''
  const addr = data.address || {}
  return {
    place_name,
    // Nominatim puts house number + road in separate fields.
    street: addr.house_number && addr.road
      ? `${addr.house_number} ${addr.road}`
      : addr.road || null,
    city: addr.city || addr.town || addr.village || addr.hamlet || null,
    state: addr.state_code || addr.state || null,
    neighborhood: addr.neighbourhood || addr.suburb || null,
    country: addr.country_code
      ? addr.country_code.toUpperCase()
      : addr.country || null,
    zip: addr.postcode || null
  }
}
