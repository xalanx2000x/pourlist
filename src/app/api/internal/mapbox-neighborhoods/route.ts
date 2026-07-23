/**
 * Internal route — NOT publicly linked.
 * Uses MAPBOX_SERVER_TOKEN (server-only, no URL restrictions) to enumerate
 * all Mapbox neighborhood features within NYC's place boundary.
 *
 * GET /api/internal/mapbox-neighborhoods
 *
 * Authorization: SEED_PASSWORD env must be present (server-side invocation guard).
 * Returns CSV of all NYC neighborhood names from Mapbox, with venue counts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  // Guard: only allow server-side invocation (SEED_PASSWORD is set on server)
  if (!process.env.SEED_PASSWORD) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const token = process.env.MAPBOX_SERVER_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'MAPBOX_SERVER_TOKEN not configured' }, { status: 500 })
  }

  // Step 1: get NYC place boundary ID from Mapbox Geocoding API
  const parentUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/New%20York.json?types=place&access_token=${token}`
  const parentRes = await fetch(parentUrl)
  if (!parentRes.ok) {
    return NextResponse.json({ error: 'failed to geocode NYC', status: parentRes.status }, { status: 502 })
  }
  const parentData = await parentRes.json()
  const nyFeature = parentData.features?.[0]
  if (!nyFeature) {
    return NextResponse.json({ error: 'NYC place not found in Mapbox' }, { status: 404 })
  }
  const nyId = nyFeature.id // e.g. "place.12345"

  // Step 2: list all neighborhood children of the NYC place boundary
  const boundaryUrl = `https://api.mapbox.com/geocoding/v5/mapbox.boundaries-v5/${nyId}/neighborhood.json?access_token=${token}&limit=200`
  const boundaryRes = await fetch(boundaryUrl)
  if (!boundaryRes.ok) {
    return NextResponse.json({ error: 'boundaries API failed', status: boundaryRes.status }, { status: 502 })
  }
  const boundaryData = await boundaryRes.json()

  // Step 3: extract neighborhood names from the boundaries response
  const mapboxNeighborhoods = new Set<string>()
  if (boundaryData.features) {
    for (const f of boundaryData.features) {
      // Use short_code (e.g. "manhattan-community-board-4") if available,
      // fall back to name (e.g. "Manhattan Community Board 4")
      if (f.properties?.short_code) mapboxNeighborhoods.add(f.properties.short_code)
      if (f.properties?.name) mapboxNeighborhoods.add(f.properties.name)
    }
  }

  // Step 4: get venue counts per neighborhood from Supabase (all NYC venues, all statuses)
  const { data: venueData } = await supabase
    .from('venues')
    .select('neighborhood')
    .eq('state', 'New York')
    .not('neighborhood', 'is', null)

  const venueCounts: Record<string, number> = {}
  for (const row of venueData ?? []) {
    const n = (row.neighborhood as string | null)?.trim()
    if (n) venueCounts[n] = (venueCounts[n] ?? 0) + 1
  }

  // Step 5: build CSV — all Mapbox neighborhoods, with venue count (0 if none in DB)
  const csvRows = ['mapbox_neighborhood,display_name,total_venue_count']
  for (const n of Array.from(mapboxNeighborhoods).sort()) {
    const count = venueCounts[n] ?? 0
    csvRows.push(`${n},,${count}`)
  }

  return new NextResponse(csvRows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="neighborhoods-NY-NewYork-all.csv"',
    },
  })
}
