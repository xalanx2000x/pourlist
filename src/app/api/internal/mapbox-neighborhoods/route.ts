/**
 * Internal route — NOT publicly linked.
 * Uses MAPBOX_SERVER_TOKEN to get ALL real NYC neighborhood names from Mapbox.
 *
 * Approach: Mapbox's neighborhood tileset (mapbox.mapbox-streets-v8) stores real
 * neighborhood names in feature properties. We query it via tile features using a
 * grid of NYC coordinates to get the actual named neighborhoods.
 *
 * GET /api/internal/mapbox-neighborhoods
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function getMapboxNeighborhoods(token: string): Promise<{ neighborhoods: string[], error?: string }> {
  // Use Mapbox Tilequery API to get neighborhood features from the Streets tileset
  // Tilequery returns all vector layer features at a given coordinate.
  // We use a grid of points across NYC to sample neighborhood polygons.
  //
  // NYC bounding box: lon -74.26 to -73.70, lat 40.49 to 40.92
  // Grid step: 0.02 degrees (~2km) = ~1000 points total

  const seen = new Set<string>()
  const neighborhoods: string[] = []

  // Sample grid of points across NYC
  const bbox = { minLon: -74.26, minLat: 40.49, maxLon: -73.70, maxLat: 40.92 }
  const step = 0.02

  for (let lon = bbox.minLon; lon <= bbox.maxLon; lon += step) {
    for (let lat = bbox.minLat; lat <= bbox.maxLat; lat += step) {
      const tilequeryUrl = `https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/tilequery/${lon},${lat}.json?layers=neighborhood&access_token=${token}`
      try {
        const res = await fetch(tilequeryUrl)
        if (!res.ok) continue
        const data = await res.json()
        if (data.features) {
          for (const f of data.features) {
            const name = f.properties?.name || f.properties?.neighborhood
            if (name && !seen.has(name)) {
              seen.add(name)
              neighborhoods.push(name)
            }
          }
        }
      } catch {
        // Skip failed points
      }
    }
  }

  if (neighborhoods.length === 0) {
    // Fallback: use Mapbox Search API to list neighborhoods
    const bboxStr = `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`
    const searchUrl = `https://api.mapbox.com/search/searchbox/v1/list?types=neighborhood&bbox=${bboxStr}&limit=50&access_token=${token}`
    const res = await fetch(searchUrl)
    if (res.ok) {
      const data = await res.json()
      if (data.features) {
        for (const f of data.features) {
          const name = f.properties?.name || f.text
          if (name && !seen.has(name)) {
            seen.add(name)
            neighborhoods.push(name)
          }
        }
      }
    }
  }

  return { neighborhoods: neighborhoods.sort() }
}

export async function GET(req: NextRequest) {
  if (!process.env.SEED_PASSWORD) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const token = process.env.MAPBOX_SERVER_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'MAPBOX_SERVER_TOKEN not configured' }, { status: 500 })
  }

  const { neighborhoods, error } = await getMapboxNeighborhoods(token)
  if (error) {
    return NextResponse.json({ error }, { status: 502 })
  }

  // Get venue counts per neighborhood from Supabase
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

  const csvRows = ['mapbox_neighborhood,display_name,total_venue_count']
  for (const n of neighborhoods) {
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
