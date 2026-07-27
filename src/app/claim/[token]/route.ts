import { NextRequest, NextResponse } from 'next/server'
import { verifyVenueToken } from '@/lib/venue-access'
import { supabaseServer } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

const COOKIE_NAME = 'venue_access'

const INVALID_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Invalid link</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fafafa;font-family:system-ui,sans-serif;">
  <div style="background:#fff;border-radius:1.5rem;box-shadow:0 4px 24px rgba(0,0,0,0.08);padding:2.5rem;max-width:420px;width:100%;text-align:center;">
    <div style="font-size:2.5rem;margin-bottom:1rem;">🔒</div>
    <h1 style="font-size:1.25rem;font-weight:700;color:#111;margin-bottom:0.5rem;">Link no longer valid</h1>
    <p style="font-size:0.9rem;color:#6b7280;line-height:1.6;">This link has expired or been revoked.<br>Contact us to request a new one.</p>
  </div>
</body>
</html>`

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const venueId = await verifyVenueToken(token)
  if (!venueId) {
    return new NextResponse(INVALID_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const { data: venue } = await supabaseServer
    .from('venues')
    .select('claimed_until')
    .eq('id', venueId)
    .single()

  const claimedUntil = venue?.claimed_until
    ? new Date(venue.claimed_until)
    : null

  if (!claimedUntil || claimedUntil <= new Date()) {
    return new NextResponse(INVALID_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  // Build the cookie value directly so we can attach it to the redirect response.
  // We mirror the logic from setVenueAccessCookie here rather than calling it,
  // since we need to set the cookie on a manually constructed NextResponse.
  const password = process.env.SEED_PASSWORD
  if (!password) throw new Error('SEED_PASSWORD not set')

  const expiryStr = claimedUntil.toISOString()
  const payload = `${venueId}.${expiryStr}`
  const signature = require('crypto')
    .createHmac('sha256', password)
    .update(payload)
    .digest('hex')

  const cookieValue = `${payload}.${signature}`
  const maxAge = Math.floor((claimedUntil.getTime() - Date.now()) / 1000)

  const redirectUrl = new URL('/manage', request.url)
  const response = NextResponse.redirect(redirectUrl, 303)

  response.cookies.set({
    name: COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  })

  return response
}
