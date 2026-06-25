/**
 * /[state]/[city]/[slug] — Unified third-segment route.
 *
 * Disambiguation order (per approved design):
 *   1. Neighborhood  — slug treated as neighborhood fragment; look up in venues.neighborhood
 *   2. Venue          — otherwise look up by new_slug
 *   3. 404            — not found
 *
 * Neighborhood precedence: prevents any future collision where a venue slug
 * could shadow a neighborhood URL. The collision guard in slug.ts also
 * prevents resolveNewSlug from assigning a venue slug that matches a
 * neighborhood fragment.
 *
 * Threshold gate: a neighborhood page renders only when ≥15 qualifying
 * venues exist in that neighborhood (same threshold as getQualifyingNeighborhoods).
 * Below threshold → notFound() (no thin indexed pages).
 *
 * SEO: neighborhoods that clear the threshold are included in sitemap.
 * Venues are included as before.
 */
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { supabaseServer } from '@/lib/supabase-server'
import { popularityScore, fetchViewCounts } from '@/lib/popularity'
import { hasHappyHourData } from '@/lib/happy-hour-data'
import { slugifyName } from '@/lib/slug'
import { NEIGHBORHOOD_THRESHOLD } from '@/lib/neighborhoods'
import CityPageClient from '@/components/CityPageClient'
import type { LeanVenueForHH, PopularVenue } from '@/components/CityPageClient'

const BASE_URL = 'https://pourlist.app'

// ─── Shared column list ────────────────────────────────────────────────────────
const HH_COLS = [
  'id', 'name', 'slug', 'new_slug', 'neighborhood', 'lat', 'lng', 'city', 'state', 'address',
  'hh_type', 'hh_time', 'hh_days', 'hh_exclude_days', 'hh_start', 'hh_end',
  'hh_type_2', 'hh_days_2', 'hh_exclude_days_2', 'hh_start_2', 'hh_end_2',
  'hh_type_3', 'hh_days_3', 'hh_exclude_days_3', 'hh_start_3', 'hh_end_3',
  'opening_min', 'last_verified', 'created_at',
].join(', ')

// ─── Neighborhood fetch ────────────────────────────────────────────────────────

interface NeighborhoodPageData {
  kind: 'neighborhood'
  neighborhood: string
  venues: LeanVenueForHH[]
  popularVenues: { id: string; name: string; new_slug: string | null; neighborhood: string | null; address: string | null; score: number; viewCount: number }[]
  qualifyingCount: number
  state: string
  city: string
  cityName: string
}

async function getNeighborhoodPage(
  state: string,
  city: string,
  neighborhoodSlug: string
): Promise<NeighborhoodPageData | null> {
  const stateUpper = state.toUpperCase()
  // city param is already capitalized via capitalizeCity
  const cityName = city

  // Find all venues in this (city, state, neighborhood) that are qualifying
  const { data: venueData, error } = await supabaseServer
    .from('venues')
    .select(HH_COLS)
    .eq('state', stateUpper)
    .eq('city', cityName)
    .eq('status', 'verified')
    .not('hh_type', 'is', null)
    .not('neighborhood', 'is', null)

  if (error || !venueData) return null

  // Filter to the matching neighborhood + geo-complete (city/state not null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allNeighborhoodVenues: LeanVenueForHH[] = (venueData as any).filter((v: any) => {
    const nSlug = slugifyName(v.neighborhood ?? '')
    return nSlug === neighborhoodSlug && !!v.city && !!v.state
  })

  // Threshold gate: must have ≥15 qualifying venues
  if (allNeighborhoodVenues.length < NEIGHBORHOOD_THRESHOLD) return null

  // Fetch view counts for Most Popular section
  const viewCounts = await fetchViewCounts(
    allNeighborhoodVenues.map(v => v.id),
    supabaseServer
  )

  const scored = allNeighborhoodVenues
    .map((v: any) => ({
      id: v.id,
      name: v.name ?? '',
      new_slug: v.new_slug,
      neighborhood: v.neighborhood,
      address: v.address,
      score: popularityScore(viewCounts[v.id] ?? 0, v.last_verified ?? null, v.created_at ?? ''),
      viewCount: viewCounts[v.id] ?? 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)

  return {
    kind: 'neighborhood',
    neighborhood: allNeighborhoodVenues[0]?.neighborhood ?? neighborhoodSlug,
    venues: allNeighborhoodVenues,
    popularVenues: scored,
    qualifyingCount: allNeighborhoodVenues.length,
    state,
    city,
    cityName,
  }
}

// ─── Venue fetch ───────────────────────────────────────────────────────────────

async function getVenueByNewSlug(state: string, city: string, slugFragment: string) {
  const newSlug = `/${state}/${city}/${slugFragment}`
  try {
    const { data } = await supabaseServer
      .from('venues')
      .select('*')
      .eq('new_slug', newSlug)
      .single()
    if (data && data.state?.toLowerCase() === state && data.city?.toLowerCase() === city) {
      return data
    }
    return null
  } catch {
    return null
  }
}

// Fallback: old slug format
async function getVenueByOldSlug(slug: string) {
  try {
    const { data } = await supabaseServer.from('venues').select('*').eq('slug', slug).single()
    return data
  } catch {
    return null
  }
}

// ─── Disambiguation ───────────────────────────────────────────────────────────

async function getPageData(state: string, city: string, slug: string) {
  const neighborhoodSlug = slugifyName(slug)

  // 1. Try neighborhood first (neighborhood wins)
  const neighborhoodPage = await getNeighborhoodPage(state, city, neighborhoodSlug)
  if (neighborhoodPage) return neighborhoodPage

  // 2. Try venue by new_slug
  const venue = await getVenueByNewSlug(state, city, slug)
  if (venue) return { kind: 'venue' as const, venue }

  // 3. Fallback: old slug
  const oldVenue = await getVenueByOldSlug(slug)
  if (oldVenue) return { kind: 'venue' as const, venue: oldVenue }

  return null
}

// ─── Static params (pre-render) ────────────────────────────────────────────────

export async function generateStaticParams() {
  // Pre-render qualifying neighborhoods and all qualifying venues
  try {
    // Neighborhood query: all (city, state, neighborhood) combos for threshold calc
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const neighborhoodsResult = await (supabaseServer
      .from('venues')
      .select('city, state, neighborhood')
      .not('neighborhood', 'is', null)
      .not('city', 'is', null)
      .not('state', 'is', null)
      .eq('status', 'verified')
      .not('hh_type', 'is', null) as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const venuesResult = await (supabaseServer
      .from('venues')
      .select('id, new_slug, slug, state, city, needs_geo_review, is_seed_data')
      .not('hh_type', 'is', null)
      .not('new_slug', 'is', null) as any)

    const neighborhoods = neighborhoodsResult.data ?? []
    const venues = venuesResult.data ?? []
    const paramsSet = new Set<string>()

    // Qualifying neighborhoods (≥15 qualifying venues)
    const byKey: Record<string, number> = {}
    for (const v of neighborhoods) {
      const s = (v.state ?? '').toLowerCase()
      const c = (v.city ?? '').toLowerCase()
      const n = slugifyName(v.neighborhood ?? '')
      if (!n) continue
      byKey[`${s}/${c}/${n}`] = (byKey[`${s}/${c}/${n}`] ?? 0) + 1
    }
    for (const [key, count] of Object.entries(byKey)) {
      if (count >= NEIGHBORHOOD_THRESHOLD) {
        const [st, ct, ns] = key.split('/')
        paramsSet.add(`${st}/${ct}/${ns}`)
      }
    }

    // Qualifying venues (all venues with new_slug that are geo-complete)
    for (const v of venues) {
      if (v.is_seed_data === true || v.needs_geo_review === true) continue
      if (!v.new_slug) continue
      const parts = v.new_slug.split('/')
      if (parts.length === 4) {
        paramsSet.add(`${parts[1]}/${parts[2]}/${parts[3]}`)
      }
    }

    return Array.from(paramsSet).map(p => {
      const parts = p.split('/')
      return { state: parts[0], city: parts[1], slug: parts.slice(2).join('/') }
    })
  } catch {
    return []
  }
}

export const dynamicParams = true
export const revalidate = 86_400

// ─── Metadata ─────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; city: string; slug: string }>
}): Promise<Metadata> {
  const { state, city, slug } = await params
  const pageData = await getPageData(state, city, slug)
  if (!pageData) return { title: 'Not found' }

  if (pageData.kind === 'neighborhood') {
    const { neighborhood, qualifyingCount, cityName } = pageData
    return {
      title: `${neighborhood} Happy Hours — ${cityName}`,
      description: `${qualifyingCount} happy hour bars and restaurants in ${neighborhood}, ${cityName}. Live deals, starting soon, and most popular spots.`,
      robots: { index: true, follow: true },
    }
  }

  const venue = pageData.venue
  const indexable = hasHappyHourData(venue)
  const name = venue.name ?? 'Venue'
  return {
    title: name,
    robots: indexable ? {} : { index: false, follow: true },
  }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function UnifiedSlugPage({
  params,
}: {
  params: Promise<{ state: string; city: string; slug: string }>
}) {
  const { state, city, slug } = await params
  const pageData = await getPageData(state, city, slug)
  if (!pageData) notFound()

  // ── Neighborhood page ──────────────────────────────────────────────────────
  if (pageData.kind === 'neighborhood') {
    const { neighborhood, venues, popularVenues, state: st, cityName } = pageData
    const stateUpper = st.toUpperCase()
    const heading = `${neighborhood} Happy Hours`
    const subheading = `${venues.length} spots — live, starting soon, and most popular`

    return (
      <div className="min-h-screen bg-white dark:bg-gray-950">
        <header className="border-b border-gray-200 bg-white dark:bg-gray-900 px-4 py-4">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <a
              href={`/${st}/${cityName.toLowerCase()}`}
              className="text-amber-600 hover:text-amber-700 font-semibold text-sm"
            >
              ← {cityName}
            </a>
          </div>
        </header>
        <main>
          <CityPageClient
            heading={heading}
            subheading={subheading}
            state={st}
            citySlug={cityName.toLowerCase()}
            allVenues={venues}
            popularVenues={popularVenues}
            qualifyingNeighborhoods={[]}
          />
        </main>
      </div>
    )
  }

  // ── Venue page ──────────────────────────────────────────────────────────────
  const venue = pageData.venue
  const indexable = hasHappyHourData(venue)
  const { getHhLabel } = await import('@/lib/format-schedule')
  const { formatAddress, normalizeAddress } = await import('@/lib/format-address')
  const { buildVenueTitle } = await import('@/lib/format-title')
  const { default: VenueLiveBadge } = await import('@/components/VenueLiveBadge')
  const schedule = getHhLabel(venue)
  const canonical = `${BASE_URL}${venue.new_slug ?? `/${state}/${city}/${slug}`}`

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': venue.type === 'Restaurant' ? 'Restaurant' : 'BarOrPub',
    name: venue.name,
    url: canonical,
  }
  const cleanAddress = normalizeAddress(venue.address)
  if (cleanAddress) {
    schema.address = {
      '@type': 'PostalAddress',
      streetAddress: cleanAddress,
      addressLocality: venue.city ?? city,
      addressRegion: (venue.state ?? state).toUpperCase(),
      postalCode: venue.zip ?? '',
      addressCountry: 'US',
    }
  }
  if (venue.lat != null && venue.lng != null) {
    schema.geo = { '@type': 'GeoCoordinates', latitude: venue.lat, longitude: venue.lng }
  }
  if (venue.menu_text) schema.description = venue.menu_text

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      <div className="min-h-screen bg-white dark:bg-gray-950">
        <header className="border-b border-gray-200 bg-white dark:bg-gray-900 px-4 py-4">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <a href="/" className="text-amber-600 hover:text-amber-700 font-semibold text-sm">
              ← PourList map
            </a>
            <VenueLiveBadge venue={venue} />
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-4 py-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">{venue.name}</h1>
          {formatAddress(venue) && (
            <p className="text-gray-500 text-sm mb-6">{formatAddress(venue)}</p>
          )}
          {indexable ? (
            <div className="space-y-6">
              {schedule && (
                <div>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Happy Hour</h2>
                  <p className="text-lg text-gray-900 dark:text-gray-100">{schedule}</p>
                </div>
              )}
              {venue.menu_text && (
                <div>
                  <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Deals &amp; Menu</h2>
                  <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{venue.menu_text}</p>
                </div>
              )}
              {venue.lat != null && venue.lng != null && (
                <a
                  href={`/?venue=${slug}`}
                  className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors shadow-sm"
                >
                  📍 View on map
                </a>
              )}
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
              <p className="text-gray-900 font-semibold mb-1.5 text-base">No happy hour here yet — be the first!</p>
              <p className="text-gray-700 text-sm mb-5">
                Snap a photo of the menu and you&apos;ll put <span className="font-medium">{venue.name}</span> on the map for everyone.
              </p>
              <a
                href={`/?venue=${slug}`}
                className="inline-flex items-center justify-center gap-2 w-full sm:w-auto bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-semibold py-3 px-6 rounded-xl transition-colors shadow-sm"
              >
                📷 Scan Menu
              </a>
            </div>
          )}
        </main>
      </div>
    </>
  )
}
