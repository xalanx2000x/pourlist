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
