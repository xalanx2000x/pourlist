import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkSeedAuth } from '@/lib/seed-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// GET /api/seed/neighborhoods?city=X&state=Y
// Returns all distinct raw Mapbox neighborhood names for the given city,
// with current qualifying-venue counts per name, as CSV.
export async function GET(req: NextRequest) {
  if (!(await checkSeedAuth())) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const city = searchParams.get('city')
  const state = searchParams.get('state')

  if (!city || !state) {
    return NextResponse.json(
      { success: false, reason: 'missing_city_or_state' },
      { status: 400 }
    )
  }

  const cityUpper = city.trim()
  const stateUpper = state.trim().toUpperCase()

  // Fetch ALL Manhattan venues with a raw neighborhood value — all statuses, seed and real, HH and non-HH
  const { data, error } = await supabase
    .from('venues')
    .select('id, neighborhood, city, state')
    .eq('state', stateUpper)
    .eq('city', cityUpper)
    .not('neighborhood', 'is', null)

  if (error) {
    console.error('[seed/neighborhoods GET] query error:', error)
    return NextResponse.json({ success: false, reason: 'db_error', error: error.message }, { status: 500 })
  }

  // Count all venues per raw neighborhood
  const counts: Record<string, number> = {}
  for (const row of data ?? []) {
    const n = (row.neighborhood as string | null)?.trim()
    if (!n) continue
    counts[n] = (counts[n] ?? 0) + 1
  }

  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1]) // descending by total venue count
    .map(([neighborhood, count]) => ({ neighborhood, count }))

  // Build CSV manually
  const header = 'mapbox_neighborhood,display_name,total_venue_count\n'
  const csv = rows
    .map(r => `${r.neighborhood},,${r.count}`)
    .join('\n')

  return new NextResponse(header + csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="neighborhoods-${stateUpper}-${cityUpper.replace(/ /g, '-')}.csv"`,
    },
  })
}

// POST /api/seed/neighborhoods
// Accepts a CSV body with columns: mapbox_neighborhood,display_name
// Rows where display_name is empty are skipped.
// Upserts into neighborhood_map, then runs scoped backfill for that city/state.
export async function POST(req: NextRequest) {
  if (!(await checkSeedAuth())) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 })
  }

  let text: string
  try {
    text = await req.text()
  } catch {
    return NextResponse.json({ success: false, reason: 'empty_body' }, { status: 400 })
  }

  const lines = text.trim().split('\n')
  if (lines.length < 2) {
    return NextResponse.json({ success: false, reason: 'no_data_rows' }, { status: 400 })
  }

  // Parse CSV — simple split, handles quoted fields roughly
  function parseCsvLine(line: string): string[] {
    const result: string[] = []
    let current = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++ }
        else inQuotes = !inQuotes
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += ch
      }
    }
    result.push(current.trim())
    return result
  }

  const header = parseCsvLine(lines[0])
  const mapboxIdx = header.indexOf('mapbox_neighborhood')
  const displayIdx = header.indexOf('display_name')
  const cityIdx = header.indexOf('city')
  const stateIdx = header.indexOf('state')

  if (mapboxIdx < 0 || displayIdx < 0) {
    return NextResponse.json(
      { success: false, reason: 'missing_required_columns' },
      { status: 400 }
    )
  }

  type Mapping = { city: string; state: string; mapbox_neighborhood: string; display_name: string }
  const mappings: Mapping[] = []
  const errors: string[] = []

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i])
    const mapbox = cols[mapboxIdx] ?? ''
    const display = cols[displayIdx] ?? ''
    const city = cityIdx >= 0 ? (cols[cityIdx] ?? '') : ''
    const state = stateIdx >= 0 ? (cols[stateIdx] ?? '') : ''

    if (!mapbox) { errors.push(`line ${i + 1}: missing mapbox_neighborhood`); continue }
    if (!display) continue // blank display_name = skip this row

    if (!city || !state) { errors.push(`line ${i + 1}: missing city or state`); continue }

    mappings.push({ city: city.trim(), state: state.trim().toUpperCase(), mapbox_neighborhood: mapbox.trim(), display_name: display.trim() })
  }

  if (errors.length > 0 && mappings.length === 0) {
    return NextResponse.json({ success: false, reason: 'no_valid_mappings', errors }, { status: 400 })
  }

  // Upsert all mappings
  const { error: upsertError } = await supabase
    .from('neighborhood_map')
    .upsert(mappings, { onConflict: 'city,state,mapbox_neighborhood' })

  if (upsertError) {
    console.error('[seed/neighborhoods POST] upsert error:', upsertError)
    return NextResponse.json({ success: false, reason: 'upsert_failed', error: upsertError.message }, { status: 500 })
  }

  // Scoped backfill: for each city/state in the import, apply the mapping
  // to all existing venues whose neighborhood_raw matches
  const backfillResults: { city: string; state: string; updated: number }[] = []

  // Group mappings by city,state
  const byRegion: Record<string, Mapping[]> = {}
  for (const m of mappings) {
    const key = `${m.city}|${m.state}`
    if (!byRegion[key]) byRegion[key] = []
    byRegion[key].push(m)
  }

  for (const [key, regionMappings] of Object.entries(byRegion)) {
    const [city, state] = key.split('|')

    // Build a map of mapbox_neighborhood → display_name for this region
    const lookup: Record<string, string> = {}
    for (const m of regionMappings) {
      lookup[m.mapbox_neighborhood] = m.display_name
    }

    // Update venues where neighborhood_raw matches one of the mapped raw names
    const rawNames = Object.keys(lookup)
    const { data: matching, error: matchError } = await supabase
      .from('venues')
      .select('id, neighborhood, neighborhood_raw')
      .eq('city', city)
      .eq('state', state)
      .in('neighborhood_raw', rawNames)

    if (matchError) {
      console.error(`[seed/neighborhoods] backfill match error for ${city}/${state}:`, matchError)
      continue
    }

    let updated = 0
    for (const venue of matching ?? []) {
      const raw = venue.neighborhood_raw as string | null
      const display = raw ? lookup[raw] : null
      if (!display) continue

      const { error: updateError } = await supabase
        .from('venues')
        .update({ neighborhood: display })
        .eq('id', venue.id)

      if (!updateError) updated++
    }

    backfillResults.push({ city, state, updated })
  }

  return NextResponse.json({
    success: true,
    mappingsUpserted: mappings.length,
    backfillResults,
    skippedRows: errors.length > 0 ? errors : undefined,
  })
}
