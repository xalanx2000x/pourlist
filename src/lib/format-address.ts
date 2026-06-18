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
  if (!venue.address_autofilled) {
    return venue.address || ''
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
  if (!display) {
    return venue.address || ''
  }

  return display
}
