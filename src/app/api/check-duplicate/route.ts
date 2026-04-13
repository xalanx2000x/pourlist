import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * POST /api/check-duplicate
 * Body: { deviceHash: string; fingerprint: string }
 *         Optional: venueId (if provided, check within that venue specifically)
 *
 * Returns: { isDuplicate: boolean; venueId?: string; existingMenuText?: string }
 *
 * Uses fingerprint (file size + name) to detect duplicate uploads from the same
 * device within the last 24 hours. If found, returns the venue so we can skip
 * re-parsing the same menu image.
 */
export async function POST(req: NextRequest) {
  try {
    const { deviceHash, fingerprint, venueId } = await req.json()

    if (!deviceHash || !fingerprint) {
      return NextResponse.json({ isDuplicate: false })
    }

    if (!fingerprint || fingerprint.trim() === '') {
      return NextResponse.json({ isDuplicate: false })
    }

    // 24-hour window
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // Build query: same device + same fingerprint (photo_hash) in last 24h
    let query = supabase
      .from('photos')
      .select('id, venue_id, photo_hash, created_at')
      .eq('uploader_device_hash', deviceHash)
      .eq('photo_hash', fingerprint)
      .gte('created_at', since)
      .limit(10)

    const { data: photos, error } = await query

    if (error) {
      console.error('Duplicate check error:', error)
      return NextResponse.json({ isDuplicate: false })
    }

    const match = (photos || []).find(p => p.photo_hash === fingerprint)

    if (!match) {
      return NextResponse.json({ isDuplicate: false })
    }

    // Found a recent duplicate — fetch venue info for response
    const matchedVenueId = match.venue_id

    // If caller passed a venueId and it doesn't match, not actually a duplicate for that venue
    if (venueId && matchedVenueId !== venueId) {
      return NextResponse.json({ isDuplicate: false })
    }

    const { data: venue } = await supabase
      .from('venues')
      .select('id, menu_text')
      .eq('id', matchedVenueId)
      .single()

    return NextResponse.json({
      isDuplicate: true,
      venueId: matchedVenueId,
      existingMenuText: venue?.menu_text ?? null
    })

  } catch (err) {
    console.error('Check duplicate error:', err)
    return NextResponse.json({ isDuplicate: false })
  }
}