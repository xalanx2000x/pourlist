import { NextRequest, NextResponse } from 'next/server'
import { checkSeedAuth } from '@/lib/seed-auth'

export async function POST(req: NextRequest) {
  if (!(await checkSeedAuth())) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 })
  }

  let body: { address?: string; city?: string; state?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, reason: 'invalid_body' }, { status: 400 })
  }

  const { address, city, state } = body
  if (!address || typeof address !== 'string' || !address.trim()) {
    return NextResponse.json({ success: false, reason: 'address_required' }, { status: 400 })
  }

  const trimmedAddress = address.trim()

  // Determine query construction
  // Check if the address already contains location info, so we don't
  // append city/state redundantly (e.g. address = "5627 SW Kelly Ave, Portland Oregon 97239").
  // Normalize: strip zip codes and normalize whitespace for the duplicate check.
  const addrNormalized = trimmedAddress.replace(/\b\d{5}(?:-\d{4})?\b/g, '').replace(/\s+/g, ' ').trim()
  const cityStateStr = `${city}, ${state}`.toLowerCase()
  const cityStateSpaceStr = `${city} ${state}`.toLowerCase()
  const addrLower = addrNormalized.toLowerCase()
  const hasCityState = addrLower.includes(cityStateStr) || addrLower.includes(cityStateSpaceStr)

  let query: string
  if (city && state) {
    // Append city/state only if not already present in the address
    query = hasCityState ? trimmedAddress : `${trimmedAddress}, ${city}, ${state}`
  } else if (city && !state) {
    // Have city, no state — append city only if not already present
    query = addrLower.includes(city.toLowerCase()) ? trimmedAddress : `${trimmedAddress}, ${city}`
  } else if (!trimmedAddress.includes(',')) {
    // No city/state AND no commas in address — looks like just a street address without location context
    return NextResponse.json(
      { success: false, reason: 'city_required', message: "Include city and state — e.g., '1020 NW 17th Ave, Portland, OR'." },
      { status: 400 }
    )
  } else {
    // No city/state but address has commas — trust the user included them
    query = trimmedAddress
  }

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN
  if (!token) {
    console.error('[geocode-address] NEXT_PUBLIC_MAPBOX_TOKEN not set')
    return NextResponse.json({ success: false, reason: 'server_config_error' }, { status: 500 })
  }

  const encoded = encodeURIComponent(query)
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=3&country=us`

  let mapboxData: Record<string, unknown>
  let mapboxStatus: number | null = null
  try {
    const res = await fetch(url)
    mapboxStatus = res.status
    if (!res.ok) {
      const text = await res.text()
      console.error('[geocode-address] Mapbox error:', res.status, text.substring(0, 200))
      return NextResponse.json({ success: false, reason: 'geocoder_error', mapboxStatus: res.status }, { status: 502 })
    }
    mapboxData = await res.json()
  } catch (err) {
    console.error('[geocode-address] fetch failed. mapboxStatus so far:', mapboxStatus, err)
    return NextResponse.json({ success: false, reason: 'network_error', mapboxStatus }, { status: 502 })
  }

  const features = mapboxData.features as Array<{
    properties: { accuracy?: string }
    relevance: number
    place_name: string
    center: [number, number] // [lng, lat]
  }>

  if (!features || features.length === 0) {
    return NextResponse.json({ success: false, reason: 'no_match' }, { status: 404 })
  }

  const top = features[0]
  const [lng, lat] = top.center
  const rawAccuracy = top.properties?.accuracy ?? ''
  const relevance = top.relevance ?? 1

  // Map accuracy string to tier
  function mapAccuracyTier(acc: string): 'precise' | 'close' | 'approximate' | 'imprecise' {
    switch (acc) {
      case 'rooftop':
      case 'parcel':
        return 'precise'
      case 'point':
      case 'interpolated':
        return 'close'
      case 'street':
      case 'address':
      case 'neighborhood':
      case 'place':
        return 'approximate'
      default:
        return 'imprecise'
    }
  }

  let tier = mapAccuracyTier(rawAccuracy)

  // Downgrade one tier if relevance is low
  if (relevance < 0.9) {
    const downgradeMap: Record<string, string> = {
      precise: 'close',
      close: 'approximate',
      approximate: 'imprecise',
      imprecise: 'imprecise',
    }
    tier = downgradeMap[tier] as typeof tier
  }

  return NextResponse.json({
    success: true,
    lat,
    lng,
    accuracy: rawAccuracy || null,
    relevance,
    tier,
    place_name: top.place_name,
    query_used: query,
  })
}
