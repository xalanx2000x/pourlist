/**
 * POST /api/track-event
 * Body: { eventName: string; deviceHash: string; venueId?: string; metadata?: object }
 * Writes a row to the analytics events table. Fire-and-forget — always returns 200.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { eventName, deviceHash, venueId, metadata } = await req.json()

    if (!eventName || !deviceHash) {
      return NextResponse.json({ error: 'eventName and deviceHash required' }, { status: 400 })
    }

    await supabase.from('events').insert({
      event_name: eventName,
      device_hash: deviceHash,
      venue_id: venueId || null,
      metadata: metadata || null,
    })

    return NextResponse.json({ ok: true })
  } catch {
    // Never surface errors to the client — analytics must not break UX
    return NextResponse.json({ ok: true })
  }
}