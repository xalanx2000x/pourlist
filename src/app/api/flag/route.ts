import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isWithinPresence, PRESENCE_BASE_M, PRESENCE_CEILING_M } from '@/lib/gpsCheck'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)



/**
 * POST /api/flag
 *
 * Body (JSON):
 *   venueId: string          // venue UUID
 *   deviceHash: string       // device fingerprint
 *   reason: 'no_hh' | 'wrong'
 *   lat: number             // browser GPS latitude
 *   lng: number             // browser GPS longitude
 *
 * Response:
 *   { success: true, message: string, newStatus?: string }
 *   { success: false, error: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { venueId, deviceHash, reason, lat, lng, accuracy } = body as {
      venueId?: string
      deviceHash?: string
      reason?: string
      lat?: number
      lng?: number
      accuracy?: number
    }

    // ── Input validation ────────────────────────────────────────
    if (!venueId) {
      return NextResponse.json({ error: 'venueId is required' }, { status: 400 })
    }
    if (!deviceHash) {
      return NextResponse.json({ error: 'deviceHash is required' }, { status: 400 })
    }
    if (!reason || (reason !== 'no_hh' && reason !== 'wrong')) {
      return NextResponse.json({ error: 'reason must be "no_hh" or "wrong"' }, { status: 400 })
    }
    if (typeof lat !== 'number' || typeof lng !== 'number') {
      return NextResponse.json({ error: 'lat and lng are required' }, { status: 400 })
    }

    // ── Fetch venue to get GPS ────────────────────────────────
    const { data: venue, error: venueError } = await supabase
      .from('venues')
      .select('id, lat, lng, status')
      .eq('id', venueId)
      .single()

    if (venueError || !venue) {
      return NextResponse.json({ error: 'Venue not found' }, { status: 404 })
    }

    // ── GPS verification: user must be within 15m of venue ───────
    if (venue.lat == null || venue.lng == null) {
      // Venue has no GPS — can't verify. Reject.
      return NextResponse.json(
        { error: 'Cannot verify location for this venue' },
        { status: 400 }
      )
    }

    const allowed = Math.min(
      PRESENCE_CEILING_M,
      Math.max(PRESENCE_BASE_M, accuracy != null && !isNaN(accuracy) ? accuracy : PRESENCE_BASE_M)
    )
    if (!isWithinPresence(lat, lng, venue.lat, venue.lng, accuracy ?? PRESENCE_BASE_M)) {
      return NextResponse.json(
        { error: 'You must be at the venue to flag it' },
        { status: 400 }
      )
    }

    // ── Call the database function ──────────────────────────────
    const { data, error: rpcError } = await supabase.rpc('submit_flag', {
      p_venue_id: venueId,
      p_device_hash: deviceHash,
      p_reason: reason,
      p_lat: lat,
      p_lng: lng
    })

    if (rpcError) {
      console.error('submit_flag RPC error:', rpcError)
      return NextResponse.json({ error: 'Failed to submit flag' }, { status: 500 })
    }

    // RPC returns a table result — pick the first row
    const result = Array.isArray(data) ? data[0] : data

    if (!result?.success) {
      // Map reason codes to user-friendly messages
      const reasonMessages: Record<string, string> = {
        no_submissions: 'You must submit at least one venue before you can flag',
        already_flagged: 'You have already flagged this venue',
        already_confirmed: 'You cannot flag a venue you have confirmed',
        daily_limit: 'You have reached your daily flag limit'
      }
      return NextResponse.json(
        { error: reasonMessages[result.message] || 'Cannot flag this venue' },
        { status: 429 }
      )
    }

    // ── Update device trust if this was their 10th submission ──
    // (flags don't count toward trust — submissions do, so we only
    // update trust on submissions, not here)

    return NextResponse.json({
      success: true,
      message: 'Flag submitted',
      newStatus: result.new_status || undefined
    })
  } catch (err) {
    console.error('flag API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
