import { NextRequest, NextResponse } from 'next/server'
import { checkSeedAuth } from '@/lib/seed-auth'
import { reverseGeocodeStructured } from '@/lib/gps'

/**
 * GET /api/seed/geocode?lat=X&lng=Y
 *
 * Server-side proxy of reverseGeocodeStructured, used by the /seed UI to
 * preview structured fields as Tyler types lat/lng (or address → auto-lookup).
 *
 * Requires seed_session cookie. Returns the same shape as the lib helper:
 *   { success: true, result: { place_name, street, city, state, neighborhood, country, zip } }
 */
export async function GET(req: NextRequest) {
  if (!(await checkSeedAuth())) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const latParam = url.searchParams.get('lat')
  const lngParam = url.searchParams.get('lng')
  const lat = latParam != null ? parseFloat(latParam) : NaN
  const lng = lngParam != null ? parseFloat(lngParam) : NaN

  if (isNaN(lat) || isNaN(lng)) {
    return NextResponse.json(
      { success: false, reason: 'invalid_coords' },
      { status: 400 }
    )
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return NextResponse.json(
      { success: false, reason: 'out_of_range' },
      { status: 400 }
    )
  }

  try {
    const result = await reverseGeocodeStructured(lat, lng)
    if (!result) {
      return NextResponse.json(
        { success: false, reason: 'geocode_failed' },
        { status: 502 }
      )
    }
    return NextResponse.json({ success: true, result })
  } catch (err) {
    console.error('[seed/geocode] error:', err)
    return NextResponse.json(
      { success: false, reason: 'server_error' },
      { status: 500 }
    )
  }
}