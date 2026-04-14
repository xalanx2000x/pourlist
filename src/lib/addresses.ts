/**
 * Address normalization utility.
 * Takes a free-form address string and returns canonical format:
 *   "5627 S Kelly Avenue, Portland, OR 97239" → "5627 S Kelly Ave"
 *
 * Abbreviations: Ave→Ave, St→St, Blvd→Blvd, Dr→Dr, Ln→Ln, etc.
 * Directionals (NW/NE/SE/SW/N/S/E/W) preserved.
 * Ordinals (1st, 2nd, 3rd, etc.) preserved.
 * City, state, and zip are stripped.
 * If parsing fails, returns input unchanged.
 */

const STREET_SUFFIX_ABBREV: Record<string, string> = {
  avenue: 'Ave',
  boulevard: 'Blvd',
  street: 'St',
  drive: 'Dr',
  lane: 'Ln',
  road: 'Rd',
  court: 'Ct',
  circle: 'Cir',
  place: 'Pl',
  way: 'Way',
  terrace: 'Ter',
  trail: 'Trl',
  parkway: 'Pkwy',
  highway: 'Hwy',
  'u.s.': 'US',
  us: 'US',
}

const DIRECTIONALS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NS', 'EW'])

/**
 * Parse a free-form address and return a canonical single-line format.
 * Strips city, state, zip. Abbreviates street types.
 * Returns input unchanged if parsing fails.
 */
export function normalizeAddress(rawAddress: string): string {
  if (!rawAddress || typeof rawAddress !== 'string') return rawAddress

  try {
    // Split on commas — address is typically: "number direction name type, city, state zip"
    const parts = rawAddress.split(',').map(p => p.trim())

    // First part should be the street address
    const streetPart = parts[0] || ''
    const tokens = streetPart.split(/\s+/).filter(Boolean)

    if (tokens.length < 2) return rawAddress

    // Token 0 = house number
    const houseNum = tokens[0]
    if (!/^\d+/.test(houseNum)) return rawAddress

    // Build normalized tokens starting with house number
    const normalized: string[] = [houseNum]

    // Token 1 = could be a directional (N, S, E, W, NE, NW, SE, SW)
    let idx = 1
    if (tokens[idx] && DIRECTIONALS.has(tokens[idx].toUpperCase())) {
      normalized.push(tokens[idx].toUpperCase())
      idx++
    }

    // Remaining tokens = street name
    // The last token may be a street type abbreviation
    const remaining = tokens.slice(idx)
    if (remaining.length === 0) return rawAddress

    // Check if last token is a street suffix
    const lastToken = remaining[remaining.length - 1]?.toLowerCase()
    const secondLast = remaining[remaining.length - 2]?.toLowerCase()

    // Handle ordinal street names like "E 2nd St" — the ordinal is part of the name
    const ORDINAL_REGEX = /^(\d+)(st|nd|rd|th)$/i

    if (remaining.length === 1) {
      // Just one token left — if it's a suffix, it's ambiguous; keep it
      normalized.push(remaining[0])
    } else {
      // Check if last token is a known street suffix
      const isStreetSuffix = lastToken in STREET_SUFFIX_ABBREV

      if (isStreetSuffix) {
        // Everything except the suffix is the street name
        const streetNameTokens = remaining.slice(0, -1)
        // Abbreviate street name suffix if it's a known suffix word
        const abbrev = STREET_SUFFIX_ABBREV[lastToken]

        // Append street name tokens
        for (const tok of streetNameTokens) {
          const ordMatch = tok.match(ORDINAL_REGEX)
          if (ordMatch) {
            // "2nd" stays "2nd" (ordinals preserved)
            normalized.push(tok)
          } else {
            normalized.push(tok)
          }
        }
        normalized.push(abbrev)
      } else {
        // No known suffix found — just append all remaining tokens
        for (const tok of remaining) {
          const ordMatch = tok.match(ORDINAL_REGEX)
          if (ordMatch) {
            normalized.push(tok)
          } else {
            normalized.push(tok)
          }
        }
      }
    }

    return normalized.join(' ')
  } catch {
    // If anything goes wrong, return the input unchanged
    return rawAddress
  }
}
