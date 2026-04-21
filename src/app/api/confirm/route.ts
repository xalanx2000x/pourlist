import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isWithinRadius } from '@/lib/gpsCheck'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const GPS_MAX_METERS = 50

/**
 * POST /api/confirm
 *
 * Body (JSON):
 *   venueId: string          // venue UUID
 *   deviceHash: string       // device fingerprint
 *   lat: number             // browser GPS latitude
 *   lng: number             // browser GPS longitude
 *
 * Response:
 *   { success: true, message: string }
 *   { success: false, error: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { venueId, deviceHash, lat, lng } = body as {
      venueId?: string
      deviceHash?: string
      lat?: number
      lng?: number
    }

    // ── Input validation ────────────────────────────────────────
    if (!venueId) {
      return NextResponse.json({ error: 'venueId is required' }, { status: 400 })
    }
    if (!deviceHash) {
      return NextResponse.json({ error: 'deviceHash is required' }, { status: 400 })
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
    }

    // ── Fetch venue to get GPS ────────────────────────────────
    const { data: venue, error: venueError } = await supabase
      .from('venues')
      .select('id, lat, lng')
      .eq('id', venueId)
      .single()

    if (venueError || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 })
    }

    // ── GPS verification: user must be within 50m of venue ───────
    if (venue.lat == null || venue.lng == null) {
      return NextResponse.json(
        { error: 'Cannot verify location for this venue' },
        { status: 400 }
      )
    }

    if (!isWithinRadius(lat, lng, venue.lat, venue.lng, GPS_MAX_METERS)) {
      return NextResponse.json(
        { error: 'You must be within 50 meters of the venue to confirm it' },
        { status: 400 }
      )
    }

    // ── Call the database function ──────────────────────────────
    const { data, error: rpcError } = await supabase.rpc('confirm_venue', {
      p_venue_id: venueId,
      p_device_hash: deviceHash
    })

    if (rpcError) {
      console.error('confirm_venue RPC error:', rpcError)
      return NextResponse.json({ error: 'Failed to confirm venue' }, { status: 500 })
    }

    const result = Array.isArray(data) ? data[0] : data

    if (!result?.success) {
      const reasonMessages: Record<string, string> = {
        has_flagged: 'You cannot confirm a venue you have flagged',
        already_confirmed: 'You have already confirmed this venue'
      }
      return NextResponse.json(
        { error: reasonMessages[result.message] || 'Cannot confirm this venue' },
        { status: 429 }
      )
    }

    return NextResponse.json({ success: true, message: 'Venue confirmed' })
  } catch (err) {
    console.error('confirm API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
