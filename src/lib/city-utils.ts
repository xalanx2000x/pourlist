/**
 * Converts a URL-safe city slug ("portland", "st-johns", "lake-oswego")
 * to its display form ("Portland", "St Johns", "Lake Oswego").
 * Inverse of slugifyName for the city dimension.
 */
export function capitalizeCity(city: string): string {
  return city
    .split(/[\s-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}
