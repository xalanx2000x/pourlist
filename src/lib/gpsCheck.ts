/**
 * Haversine distance between two GPS coordinates in meters.
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Presence gate base radius (meters) — minimum gate even with perfect GPS.
 * Clean GPS (accuracy ≤25m) → gate is 25m (tight).
 */
export const PRESENCE_BASE_M = 25

/**
 * Presence gate ceiling (meters) — max gate even with garbage GPS accuracy.
 * Garbage GPS (accuracy >75m) → gate capped at 75m.
 */
export const PRESENCE_CEILING_M = 75

/**
 * Accuracy-aware presence check. The allowed radius adapts to the phone's
 * reported GPS accuracy, clamped between BASE and CEILING.
 *
 * @param accuracyM phone's reported GPS accuracy in meters (position.coords.accuracy)
 */
export function isWithinPresence(
  pointLat: number,
  pointLng: number,
  refLat: number,
  refLng: number,
  accuracyM?: number
): boolean {
  const allowed = Math.min(
    PRESENCE_CEILING_M,
    Math.max(PRESENCE_BASE_M, accuracyM || PRESENCE_BASE_M)
  )
  return haversineDistance(pointLat, pointLng, refLat, refLng) <= allowed
}

/**
 * Check if a GPS point is within MAX_DISTANCE meters of a reference point.
 */
export function isWithinRadius(
  pointLat: number,
  pointLng: number,
  refLat: number,
  refLng: number,
  maxDistanceMeters: number
): boolean {
  return haversineDistance(pointLat, pointLng, refLat, refLng) <= maxDistanceMeters
}
