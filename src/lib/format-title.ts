/**
 * buildVenueTitle(venue) — assembles the <title> tag for a venue page.
 *
 *   With city:    "Bar Diane Happy Hour — Portland | PourList"
 *   Without city: "Bar Diane Happy Hour | PourList"
 *
 * The city is a data slot, not part of the template. When venue.city
 * populates from the address backfill (migration 010 + commit 3 of the
 * address refactor), the "— {City}" segment flows in automatically.
 * No code change required.
 *
 * The em-dash before the city is a *segment separator* — when the city
 * is absent, the em-dash is omitted too, so the title never shows
 * dangling punctuation or a placeholder like "Unknown".
 *
 * Target 50–60 chars with typical venue names. Very long names are
 * allowed to exceed the target — better to preserve venue identity
 * than to truncate mid-name.
 */
export function buildVenueTitle(venue: {
  name: string | null
  city: string | null
}): string {
  const name = (venue.name ?? '').trim()
  const city = (venue.city ?? '').trim()

  if (!name) return 'PourList'

  const venueSegment = `${name} Happy Hour`
  const citySegment = city ? ` — ${city}` : ''

  return `${venueSegment}${citySegment} | PourList`
}
