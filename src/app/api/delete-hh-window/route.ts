import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isWithinPresence, PRESENCE_BASE_M, PRESENCE_CEILING_M } from '@/lib/gpsCheck'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST /api/delete-hh-window
 *
 * Body (JSON):
 *   venueId: string          // venue UUID
 *   deviceHash: string       // device fingerprint
 *   windowSlot: 1 | 2 | 3    // which HH window to delete
 *   lat: number             // browser GPS latitude
 *   lng: number             // browser GPS longitude
 *   accuracy?: number       // browser GPS accuracy (meters)
 *
 * Response:
 *   { success: true, message: string, newStatus?: string }
 *   { success: false, error: string }
 *
 * User must be at the venue (presence verified). Threshold is 1:
 * any verified user with ≥1 submission can delete one specific HH window.
 * Recorded as a flag row with window_slot set. The global daily
 * destructive-action limit (one active flag per device per day) is
 * enforced inside the RPC.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { venueId, deviceHash, windowSlot, lat, lng, accuracy } = body as {
      venueId?: string
      deviceHash?: string
      windowSlot?: number
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
    if (windowSlot !== 1 && windowSlot !== 2 && windowSlot !== 3) {
      return NextResponse.json({ error: 'windowSlot must be 1, 2, or 3' }, { status: 400 })
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

    // ── GPS verification: user must be at the venue ──────────────
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
        { error: 'You must be at the venue to remove this schedule' },
        { status: 400 }
      )
    }

    // ── Call the database function ──────────────────────────────
    const { data, error: rpcError } = await supabase.rpc('delete_hh_window', {
      p_venue_id: venueId,
      p_device_hash: deviceHash,
      p_window_slot: windowSlot,
      p_lat: lat,
      p_lng: lng
    })

    if (rpcError) {
      console.error('delete_hh_window RPC error:', rpcError)
      return NextResponse.json({ error: 'Failed to delete window' }, { status: 500 })
    }

    // RPC returns a table result — pick the first row
    const result = Array.isArray(data) ? data[0] : data

    if (!result?.success) {
      // Map reason codes to user-friendly messages
      const reasonMessages: Record<string, string> = {
        daily_limit: "You've already reported something today — try again tomorrow",
        no_submissions: 'Submit a venue first to unlock reporting',
        empty_slot: 'That schedule was already removed',
        already_flagged: "You've already reported this venue"
      }
      return NextResponse.json(
        { error: reasonMessages[result.message] || 'Cannot remove this schedule' },
        { status: 429 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Window deleted',
      newStatus: result.new_status || undefined
    })
  } catch (err) {
    console.error('delete-hh-window API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
