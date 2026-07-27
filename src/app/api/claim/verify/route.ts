/**
 * POST /api/claim/verify
 *
 * Internal route: receives a magic-link token from the /claim/[token] client
 * component, verifies it, sets the venue_access cookie, and redirects to /manage.
 *
 * This exists because httpOnly cookies cannot be set from client-side JavaScript.
 * The client component POSTs here; this route sets the cookie then redirects.
 *
 * Body: { token: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyVenueToken, setVenueAccessCookie } from '@/lib/venue-access'
import { supabaseServer } from '@/lib/supabase-server'

export async function POST(req: NextRequest) {
  let token: string | undefined
  try {
    const body = await req.json()
    if (typeof body?.token === 'string') token = body.token
  } catch {
    return NextResponse.json({ reason: 'Invalid body' }, { status: 400 })
  }

  if (!token) {
    return NextResponse.json({ reason: 'token required' }, { status: 400 })
  }

  const venueId = await verifyVenueToken(token)
  if (!venueId) {
    return NextResponse.json({ reason: 'invalid' }, { status: 401 })
  }

  const { data: venue } = await supabaseServer
    .from('venues')
    .select('claimed_until')
    .eq('id', venueId)
    .single()

  const claimedUntil = venue?.claimed_until ? new Date(venue.claimed_until) : null
  if (!claimedUntil || claimedUntil <= new Date()) {
    return NextResponse.json({ reason: 'expired' }, { status: 401 })
  }

  await setVenueAccessCookie(venueId, claimedUntil)

  const base = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  return NextResponse.redirect(new URL('/manage', base), 303)
}
