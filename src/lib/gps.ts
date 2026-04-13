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
 * Get browser's current geolocation as a fallback.
 */
export function getBrowserLocation(): Promise<GpsCoords> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { timeout: 5000, maximumAge: 60000, enableHighAccuracy: true }
    )
  })
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
