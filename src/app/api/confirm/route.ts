import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isWithinPresence, PRESENCE_BASE_M, PRESENCE_CEILING_M } from '@/lib/gpsCheck'
import { ensureStructuredGeo } from '@/lib/venues'
import { resolveNewSlug } from '@/lib/slug'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)



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
    const { venueId, deviceHash, lat, lng, accuracy } = body as {
      venueId?: string
      deviceHash?: string
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

    // ── GPS verification: user must be within 15m of venue ───────
    if (venue.lat == null || venue.lng == null) {
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
        { error: 'You must be at the venue to confirm it' },
        { status: 400 }
      )
    }

    // ── Graduation gate: require both pieces before flipping to verified ──
    // Both hh_type and latest_menu_image_url must already exist on the venue.
    // This prevents a two-piece submission from graduating with only one piece.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data: venuePreConfirm } = await db
      .from('venues')
      .select('id, hh_type, latest_menu_image_url, city, state')
      .eq('id', venueId)
      .single()

    if (!venuePreConfirm?.hh_type) {
      return NextResponse.json(
        { error: 'Cannot confirm a venue without happy-hour details. Submit menu details first.' },
        { status: 400 }
      )
    }
    if (!venuePreConfirm?.latest_menu_image_url) {
      return NextResponse.json(
        { error: 'Cannot confirm a venue without a photo. Scan the menu first.' },
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

    // ── Geo chokepoint: populate structured geo if still incomplete ──
    // At this point venue is verified and has both hh_type + photo.
    // If city/state are still null despite coordinates, fill them now.
    await ensureStructuredGeo(venueId)

    // ── Resolve new_slug now that geo is complete ───────────────────────
    const { data: venuePostGeo } = await db
      .from('venues')
      .select('id, name, city, state')
      .eq('id', venueId)
      .single()
    if (venuePostGeo?.city && venuePostGeo?.state) {
      const { path: newSlug, needsGeoReview } = await resolveNewSlug(
        { id: venueId, name: venuePostGeo.name, city: venuePostGeo.city, state: venuePostGeo.state },
        supabase
      )
      if (newSlug !== null) {
        await db.from('venues').update({ new_slug: newSlug, needs_geo_review: needsGeoReview }).eq('id', venueId)
      } else if (needsGeoReview) {
        await db.from('venues').update({ needs_geo_review: true }).eq('id', venueId)
      }
    }

    // Reset HH staleness clock: venue was confirmed → hh_updated_at = now
    await supabase
      .from('venues')
      .update({ hh_updated_at: new Date().toISOString() })
      .eq('id', venueId)

    return NextResponse.json({ success: true, message: 'Venue confirmed' })
  } catch (err) {
    console.error('confirm API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
