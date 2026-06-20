/**
 * formatAddress(venue) — single source of truth for the visible address string.
 *
 * The display string is NEVER stored as an independent hand-maintained value
 * for autofilled venues. It is DERIVED from the structured fields (city,
 * state, neighborhood, country) according to the rules below. For venues
 * that were NOT autofilled (seed data, user-typed), the stored `address`
 * string is returned untouched — this preserves the work of human curators
 * and the existing UX.
 *
 * Decision tree:
 *   - address_autofilled == false (or null):
 *       return venue.address  ← seed venues, user-typed, anything pre-migration
 *
 *   - address_autofilled == true (reverse-geocode filled the fields):
 *       Derive from structured fields:
 *         neighborhood + city + state  → "Pearl District · Portland, OR"
 *         city + state                 → "Portland, OR"
 *         neighborhood only            → "Pearl District"
 *         city only                    → "Portland"
 *         state only                   → "OR"
 *         none (safety net)            → fall back to venue.address
 *       If country is set and != home country (default "US"), append
 *       the country name: "Gastown · Vancouver, BC, Canada"
 *
 * The home-country rule is a one-line check: countries matching HOME_COUNTRY
 * are omitted from the display (US venues don't need to say "United States").
 * Any other country is shown. Country names come from Intl.DisplayNames
 * so the rule works for future Canadian / Mexican / etc. venues.
 */

const HOME_COUNTRY = 'US'

let countryNameCache: Intl.DisplayNames | null = null
function getCountryName(code: string): string {
  if (!countryNameCache) {
    // 'en' is the only locale we ship in; the rule is about whether to
    // *show* the country, not how to spell it.
    countryNameCache = new Intl.DisplayNames(['en'], { type: 'region' })
  }
  return countryNameCache.of(code) || code
}

/**
 * The OSM seed script wrote the literal string "Unknown" into
 * `venues.address` for any row whose OSM record had no street address
 * (~20K of the ~59K seed rows, confirmed in DB: all 20,183 rows are
 * exactly "Unknown" capital U today). That's a real value (not null),
 * so it leaks into the visible card, JSON-LD, share text, and the
 * Google Maps search URL unless every read site normalizes it.
 *
 * This helper is the SINGLE normalization point. Every code path
 * that surfaces venue.address in a user-facing string (visible
 * text, SEO metadata, link previews, outbound URLs) must call
 * `normalizeAddress(...)` first. Returns '' for the OSM placeholder
 * and for null/empty. Add new placeholders to ADDRESS_PLACEHOLDERS,
 * not to scattered `if` checks across the codebase.
 *
 * Comparison is case-insensitive — the placeholder set stores canonical
 * lowercase forms, and incoming strings are trimmed + lowercased before
 * lookup. Future seed data with "UNKNOWN", "Unknown", "unknown", or any
 * other casing is caught automatically.
 */
const ADDRESS_PLACEHOLDERS = new Set(['unknown'])

export function normalizeAddress(addr: string | null | undefined): string {
  if (!addr) return ''
  if (ADDRESS_PLACEHOLDERS.has(addr.trim().toLowerCase())) return ''
  return addr
}

export function formatAddress(venue: {
  address: string | null
  city: string | null
  state: string | null
  neighborhood: string | null
  country: string | null
  address_autofilled: boolean
}): string {
  // Non-autofilled: render the stored string untouched. This is the
  // fallback that keeps seed venues rendering correctly — their
  // structured fields are all null because a human curated them.
  // normalizeAddress() ensures the OSM "Unknown" placeholder
  // (~20K seed rows) renders as '' instead of leaking through.
  if (!venue.address_autofilled) {
    return normalizeAddress(venue.address)
  }

  // Autofilled: derive from structured fields.
  const { city, state, neighborhood, country } = venue
  let display = ''

  if (neighborhood && city && state) {
    display = `${neighborhood} · ${city}, ${state}`
  } else if (neighborhood && city) {
    display = `${neighborhood} · ${city}`
  } else if (city && state) {
    display = `${city}, ${state}`
  } else if (neighborhood) {
    display = neighborhood
  } else if (city) {
    display = city
  } else if (state) {
    display = state
  }

  // Home-country rule: omit the country when it matches HOME_COUNTRY.
  // For non-US (or unknown-with-name) countries, append the country name.
  if (country && country !== HOME_COUNTRY) {
    const countryName = getCountryName(country)
    if (display) {
      display += `, ${countryName}`
    } else {
      display = countryName
    }
  }

  // Safety net: an autofilled venue with no parseable structured fields
  // should never happen (reverseGeocodeStructured always returns at least
  // place_name), but if it does, fall back to the stored address.
  // Normalized for the same reason as the non-autofilled branch above.
  if (!display) {
    return normalizeAddress(venue.address)
  }

  return display
}
