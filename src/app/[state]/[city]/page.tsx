/**
 * /[state]/[city] — City landing page.
 *
 * Server-rendered (ISR). Replaces the old redirect-to-map behavior.
 *
 * Sections:
 *   - Live Now          → client-side (browser Pacific time, always fresh)
 *   - Starting Soon     → client-side (same)
 *   - Most Popular      → server-rendered, popularityScore-ranked, capped 15
 *
 * ISR: revalidate every 5 minutes (view counts change slowly).
 * Client-side Live/Soon sections refresh every 60s via useEffect.
 */
import { Metadata } from 'next'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
import { popularityScore, fetchViewCounts } from '@/lib/popularity'
import { getQualifyingNeighborhoods } from '@/lib/neighborhoods'
import CityPageClient from '@/components/CityPageClient'

interface Props {
  params: Promise<{ state: string; city: string }>
}

const STATE_NAMES: Record<string, string> = {
  or: 'Oregon', pa: 'Pennsylvania', tx: 'Texas', ca: 'California',
  wa: 'Washington', ny: 'New York', co: 'Colorado', az: 'Arizona',
  nv: 'Nevada', fl: 'Florida', il: 'Illinois', ma: 'Massachusetts',
}

function capitalizeCity(city: string): string {
  return city
    .split(/[\s-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state, city } = await params
  const stateName = STATE_NAMES[state.toLowerCase()] ?? state.toUpperCase()
  const cityName = capitalizeCity(city)
  const title = `${cityName}, ${stateName} Happy Hours`
  const description = `Find the best happy hours in ${cityName}, ${stateName}. Live deals, starting soon, and the most popular spots — all in one place.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
    },
  }
}

export default async function CityPage({ params }: Props) {
  const { state, city } = await params
  const stateLower = state.toLowerCase()
  const cityLower = city.toLowerCase()
  const cityName = capitalizeCity(cityLower)

  // Fetch all verified Portland venues with HH data
  // Supabase cannot infer a typed return from a dynamic column string,
  // so we cast the result through a typed interface.
  interface CityPageVenue {
    id: string
    name: string
    slug: string | null
    new_slug: string | null
    neighborhood: string | null
    lat: number | null
    lng: number | null
    city: string | null
    state: string | null
    address: string | null
    hh_type: string | null
    hh_time: string | null
    hh_days: string | null
    hh_exclude_days: string | null
    hh_start: number | null
    hh_end: number | null
    hh_type_2: string | null
    hh_days_2: string | null
    hh_exclude_days_2: string | null
    hh_start_2: number | null
    hh_end_2: number | null
    hh_type_3: string | null
    hh_days_3: string | null
    hh_exclude_days_3: string | null
    hh_start_3: number | null
    hh_end_3: number | null
    opening_min: number | null
    last_verified: string | null
    created_at: string
  }

  let raw
  try {
    raw = await supabaseServer
      .from('venues')
      .select('id, name, slug, new_slug, neighborhood, lat, lng, city, state, address, hh_type, hh_time, hh_days, hh_exclude_days, hh_start, hh_end, hh_type_2, hh_days_2, hh_exclude_days_2, hh_start_2, hh_end_2, hh_type_3, hh_days_3, hh_exclude_days_3, hh_start_3, hh_end_3, opening_min, last_verified, created_at')
      .eq('state', stateLower.toUpperCase())
      .eq('city', cityName)
      .not('hh_type', 'is', null)
      .eq('status', 'verified')
  } catch (e) {
    console.error('[cityPage] DB query failed:', e)
    throw e
  }
  if (raw.error) {
    console.error('[cityPage] DB error:', raw.error)
  }
  const venueList = (raw as unknown as CityPageVenue[] | null) ?? []

  // Fetch qualifying neighborhoods (for "Browse by neighborhood" section)
  let qualifying: { neighborhood: string; venueCount: number; qualifies: boolean }[] = []
  try {
    qualifying = await getQualifyingNeighborhoods(cityName, stateLower.toUpperCase())
  } catch (e) {
    console.error('[cityPage] getQualifyingNeighborhoods failed:', e)
  }

  // Fetch view counts for popularity scoring
  let viewCounts: Record<string, number> = {}
  try {
    viewCounts = await fetchViewCounts(venueList.map(v => v.id), supabaseServer)
  } catch (e) {
    console.error('[cityPage] fetchViewCounts failed:', e)
  }

  // Compute popularity and sort for Popular section
  const venuesWithScore = venueList.map(v => ({
    ...v,
    viewCount: viewCounts[v.id] ?? 0,
    score: popularityScore(
      viewCounts[v.id] ?? 0,
      v.last_verified,
      v.created_at
    ),
  }))

  const popular = venuesWithScore
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)

  // City-level heading
  const stateName = STATE_NAMES[stateLower] ?? state.toUpperCase()
  const heading = `${cityName} Happy Hours`
  const subheading = `${stateName}`

  return (
    <CityPageClient
      heading={heading}
      subheading={subheading}
      state={stateLower}
      citySlug={cityLower}
      // Pass all HH venues for client-side Live/Soon filtering
      allVenues={venueList}
      popularVenues={popular}
      qualifyingNeighborhoods={qualifying.map(n => ({
        name: n.neighborhood,
        slug: n.neighborhood.toLowerCase().replace(/\s+/g, '-'),
        count: n.venueCount,
      }))}
    />
  )
}
