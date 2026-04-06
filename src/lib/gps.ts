import ExifReader from 'exifreader'

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
      { timeout: 5000, maximumAge: 60000 }
    )
  })
}
