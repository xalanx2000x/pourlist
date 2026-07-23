/**
 * Internal route — NOT publicly linked.
 * Uses MAPBOX_SERVER_TOKEN to enumerate ALL Mapbox neighborhood features in NYC,
 * including zero-venue neighborhoods.
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

// Probe Mapbox Boundaries API to find correct ID format for NYC
async function getMapboxNeighborhoods(token: string): Promise<{ neighborhoods: string[], error?: string }> {
  // Step 1: get NYC place ID in multiple formats from Mapbox Geocoding
  const geoUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/New%20York.json?types=place&access_token=${token}&limit=5`
  const geoRes = await fetch(geoUrl)
  if (!geoRes.ok) return { neighborhoods: [], error: `geocode failed: ${geoRes.status}` }
  const geoData = await geoRes.json()
  const nyFeature = geoData.features?.[0]
  if (!nyFeature) return { neighborhoods: [], error: 'NYC not found in Mapbox' }

  const shortId = nyFeature.id // e.g. "place.12345"
  const fullId = nyFeature.properties?.mapbox_id // e.g. "po.1234567890" — this is the correct ID for Boundaries API

  // Log both for debugging
  console.log('[mapbox-neighborhoods] NYC shortId:', shortId, 'fullId:', fullId)

  // Step 2: try Boundaries API v5 with full mapbox_id (po.xxx format)
  let allNeighborhoods: string[] = []

  if (fullId) {
    const boundaryUrl = `https://api.mapbox.com/geocoding/v5/mapbox.boundaries-v5/${fullId}/neighborhood.json?access_token=${token}&limit=200`
    const r = await fetch(boundaryUrl)
    const text = await r.text()
    console.log('[mapbox-neighborhoods] boundaries v5 status:', r.status, 'body:', text.slice(0, 200))
    if (r.ok) {
      const d = JSON.parse(text)
      if (d.features) {
        for (const f of d.features) {
          const name = f.properties?.name || f.properties?.short_code
          if (name) allNeighborhoods.push(name)
        }
      }
    }
  }

  // Step 3: if boundaries v5 fails, fall back to querying via tile features from NYC center
  if (allNeighborhoods.length === 0 && shortId) {
    // Try with short ID format — boundaries API may accept it
    const boundaryUrl2 = `https://api.mapbox.com/geocoding/v5/mapbox.boundaries-v5/${shortId}/neighborhood.json?access_token=${token}&limit=200`
    const r2 = await fetch(boundaryUrl2)
    const text2 = await r2.text()
    console.log('[mapbox-neighborhoods] boundaries v5 short-id status:', r2.status, 'body:', text2.slice(0, 200))
    if (r2.ok) {
      const d = JSON.parse(text2)
      if (d.features) {
        for (const f of d.features) {
          const name = f.properties?.name || f.properties?.short_code
          if (name) allNeighborhoods.push(name)
        }
      }
    }
  }

  // Step 4: if still empty, try using Mapbox search with bbox of NYC for neighborhoods
  if (allNeighborhoods.length === 0) {
    // Use Mapbox geocoding with bbox to get all neighborhoods in NYC
    // bbox: minLon, minLat, maxLon, maxLat for NYC
    const bbox = '-74.26,40.49,-73.70,40.92'
    const searchUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/neighborhood.json?bbox=${bbox}&limit=50&types=neighborhood&access_token=${token}`
    const r3 = await fetch(searchUrl)
    if (r3.ok) {
      const d = await r3.json()
      console.log('[mapbox-neighborhoods] search API features count:', d.features?.length)
      if (d.features) {
        for (const f of d.features) {
          const name = f.text || f.properties?.name
          if (name) allNeighborhoods.push(name)
        }
      }
    }
  }

  // Step 5: also query by center point to get surrounding neighborhoods
  const centerSearchUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/neighborhood.json?proximity=-73.985,40.748&limit=50&types=neighborhood&access_token=${token}`
  const r4 = await fetch(centerSearchUrl)
  if (r4.ok) {
    const d = await r4.json()
    if (d.features) {
      for (const f of d.features) {
        const name = f.text || f.properties?.name
        if (name && !allNeighborhoods.includes(name)) allNeighborhoods.push(name)
      }
    }
  }

  // Deduplicate
  allNeighborhoods = [...new Set(allNeighborhoods)]

  return { neighborhoods: allNeighborhoods.sort() }
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
