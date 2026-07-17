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

import { getQualifyingNeighborhoods } from '@/lib/neighborhoods'
import CityPageClient from '@/components/CityPageClient'
import { capitalizeCity } from '@/lib/city-utils'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ state: string; city: string }>
}

const STATE_NAMES: Record<string, string> = {
  or: 'Oregon', pa: 'Pennsylvania', tx: 'Texas', ca: 'California',
  wa: 'Washington', ny: 'New York', co: 'Colorado', az: 'Arizona',
  nv: 'Nevada', fl: 'Florida', il: 'Illinois', ma: 'Massachusetts',
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { state, city } = await params
  const stateName = STATE_NAMES[state.toLowerCase()] ?? state.toUpperCase()
  const cityName = capitalizeCity(city)
  return {
    title: `${cityName}, ${stateName} Happy Hours`,
    description: `Find the best happy hours in ${cityName}, ${stateName}. Live deals, starting soon, and all verified venues — all in one place.`,
    openGraph: { title: `${cityName}, ${stateName} Happy Hours`, description: `Find the best happy hours in ${cityName}, ${stateName}. Live deals, starting soon, and all verified venues — all in one place.`, type: 'website' },
  }
}

export default async function CityPage({ params }: Props) {
  const { state, city } = await params
  const stateLower = state.toLowerCase()
  const cityName = capitalizeCity(city)

  // Full column set for city page (all HH windows + popularity data)
  const COLS = [
    'id', 'name', 'slug', 'new_slug', 'neighborhood', 'lat', 'lng', 'city', 'state', 'address',
    'hh_type', 'hh_time', 'hh_days', 'hh_exclude_days', 'hh_start', 'hh_end',
    'hh_type_2', 'hh_days_2', 'hh_exclude_days_2', 'hh_start_2', 'hh_end_2',
    'hh_type_3', 'hh_days_3', 'hh_exclude_days_3', 'hh_start_3', 'hh_end_3',
    'opening_min', 'timezone', 'last_verified', 'created_at',
  ].join(', ')

  // Fetch all verified Portland venues with HH data
  const venuesResult = await supabaseServer
    .from('venues')
    .select(COLS)
    .eq('state', stateLower.toUpperCase())
    .eq('city', cityName)
    .not('hh_type', 'is', null)
    .in('status', ['verified', 'stale'])

  if (venuesResult.error) {
    console.error('[cityPage] venues error:', venuesResult.error)
  }

  const venueList = (venuesResult.data ?? []) as unknown as Record<string, unknown>[]

  // Qualifying neighborhoods
  let qualifying: { neighborhood: string; venueCount: number; qualifies: boolean }[] = []
  try {
    qualifying = await getQualifyingNeighborhoods(cityName, stateLower.toUpperCase())
  } catch (e) {
    console.error('[cityPage] getQualifyingNeighborhoods failed:', e)
  }



  const stateName = STATE_NAMES[stateLower] ?? state.toUpperCase()

  return (
    <CityPageClient
      heading={`${cityName} Happy Hours`}
      subheading={stateName}
      state={stateLower}
      citySlug={city}
      allVenues={venueList as unknown as Parameters<typeof CityPageClient>[0]['allVenues']}

      qualifyingNeighborhoods={qualifying.map(n => ({
        name: n.neighborhood,
        slug: n.neighborhood.toLowerCase().replace(/\s+/g, '-'),
        count: n.venueCount,
      }))}
      shareTitle={`${cityName} happy hours · PourList`}
      shareText={`Live happy hour info for ${cityName}`}
    />
  )
}
