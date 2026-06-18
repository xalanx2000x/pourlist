/**
 * Haversine distance between two coordinates, in meters.
 *
 * R = 6,371,000 m (mean Earth radius). Standard great-circle formula.
 * Used by getVenuesByProximity (server-side venue fetch) and the
 * client-side list reorder on page.tsx.
 *
 * Inputs are in decimal degrees. Null-safe by convention — callers
 * pre-filter venues that lack coords before calling.
 */
export function haversineM(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
