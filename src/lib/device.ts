// Generates a device fingerprint hash from available browser info
// Does NOT track personal data — only creates a consistent anonymous token
export function getDeviceHash(): string {
  const fingerprint = [
    navigator.userAgent,
    navigator.language,
    screen.width,
    screen.height,
    screen.colorDepth,
    new Date().getTimezoneOffset()
  ].join('|')

  // Simple hash function — not cryptographic, good enough for anonymous tracking
  let hash = 0
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }

  return 'device_' + Math.abs(hash).toString(36)
}

// Extract EXIF GPS data from photo (if available)
// Falls back to browser geolocation API
export async function getPhotoLocation(file: File): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    // Try browser geolocation as fallback
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          })
        },
        () => resolve(null),
        { timeout: 5000 }
      )
    } else {
      resolve(null)
    }
  })
}

// Reverse geocode coordinates to address using Nominatim (OpenStreetMap)
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      { headers: { 'User-Agent': 'PourList/1.0' } }
    )
    const data = await res.json()
    if (data.display_name) {
      return data.display_name
    }
    return null
  } catch {
    return null
  }
}
