import ExifReader from 'exifreader'

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
  throw new Error('IP geolocation failed')
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
