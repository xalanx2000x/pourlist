/**
 * USPS state/territory code lookup. Keys are lowercase for case-insensitive matching.
 * Covers all 50 states + DC + 5 inhabited territories.
 * If a string is already a valid 2-letter code, it passes through unchanged.
 * If unrecognized, returns the input as-is (caller should set needs_geo_review).
 */
export const STATE_ABBREV: Record<string, string> = {
  // 50 states
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
  // DC
  'district of columbia': 'DC',
  // Territories
  'puerto rico': 'PR', 'guam': 'GU', 'virgin islands': 'VI', 'american samoa': 'AS',
  'northern mariana islands': 'MP',
}

export function normalizeState(s: string | null | undefined): string | null {
  if (!s) return null
  // Already a valid 2-letter code — pass through unchanged
  if (/^[A-Z]{2}$/.test(s)) return s
  return STATE_ABBREV[s.toLowerCase()] ?? s
}
