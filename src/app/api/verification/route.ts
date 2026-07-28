/**
 * /api/verification — admin work page for claim requests.
 *
 * GET  — list all claim requests, joined with venues(name, city, state, phone)
 * PATCH — update status and/or admin_note on a claim request
 * POST  — issue venue access: set claimed_until, revoke old tokens, generate new one
 *
 * Auth: checkSeedAuth() via seed_session HMAC cookie.
 * Same pattern as /api/seed/* routes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkSeedAuth } from '@/lib/seed-auth'
import { generateVenueToken, revokeVenueTokens } from '@/lib/venue-access'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const VALID_STATUSES = ['new', 'contacted', 'verified', 'closed'] as const
type ClaimStatus = typeof VALID_STATUSES[number]

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  if (!(await checkSeedAuth())) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('claim_requests')
    .select(`
      id,
      contact_name,
      phone,
      email,
      note,
      status,
      admin_note,
      created_at,
      venues (
        name,
        city,
        state,
        phone
      )
    `)
    .order('status', { ascending: false })  // 'closed' last
    .order('created_at', { ascending: true }) // oldest first within status group

  if (error) {
    console.error('verification GET error:', error)
    return NextResponse.json({ success: false, reason: 'Database read failed' }, { status: 500 })
  }

  const claimRequests = (data ?? []).map((r) => {
    // venues() returns a single object or null via the join
    const v = Array.isArray(r.venues) ? r.venues[0] : (r.venues ?? null)
    return {
      id: r.id,
      venueName:    v?.name  ?? '(unknown venue)',
      venueCity:    v?.city  ?? '',
      venueState:   v?.state ?? '',
      venuePhone:   v?.phone ?? null,
      contactName:  r.contact_name,
      phone:        r.phone,
      email:        r.email,
      note:         r.note   ?? null,
      adminNote:    r.admin_note ?? null,
      status:       r.status,
      createdAt:   r.created_at,
    }
  })

  return NextResponse.json({ claimRequests, total: claimRequests.length })
}

// ── PATCH ────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  if (!(await checkSeedAuth())) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ success: false, reason: 'Invalid request body' }, { status: 400 })
  }

  const { id, status, admin_note } = body as {
    id:        string | undefined
    status:    string | undefined
    admin_note: string | undefined
  }

  if (!id || typeof id !== 'string') {
    return NextResponse.json({ success: false, reason: 'id is required' }, { status: 400 })
  }

  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status as ClaimStatus)) {
      return NextResponse.json(
        { success: false, reason: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      )
    }
  }

  const updates: Record<string, unknown> = {}
  if (status    !== undefined) updates.status     = status
  if (admin_note !== undefined) updates.admin_note = admin_note

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ success: false, reason: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('claim_requests')
    .update(updates)
    .eq('id', id)

  if (error) {
    console.error('verification PATCH error:', error)
    return NextResponse.json({ success: false, reason: 'Update failed' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

// ── POST — issue venue access ────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!(await checkSeedAuth())) {
    return NextResponse.json({ success: false, reason: 'unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ success: false, reason: 'Invalid request body' }, { status: 400 })
  }

  const { request_id, term_days } = body as {
    request_id?: string
    term_days?: number
  }

  if (!request_id || typeof request_id !== 'string') {
    return NextResponse.json({ success: false, reason: 'request_id is required' }, { status: 400 })
  }

  const term = typeof term_days === 'number' && term_days > 0 ? term_days : 365

  // Fetch the claim request
  const { data: reqData, error: reqError } = await supabase
    .from('claim_requests')
    .select('id, venue_id, email')
    .eq('id', request_id)
    .limit(1)

  if (reqError) {
    return NextResponse.json({ success: false, reason: 'Failed to fetch claim request' }, { status: 500 })
  }
  if (!reqData || reqData.length === 0) {
    return NextResponse.json({ success: false, reason: 'Claim request not found' }, { status: 404 })
  }

  const claimReq = reqData[0]
  const venueId: string = claimReq.venue_id

  // Fetch the venue's current claimed_until
  const { data: venueData, error: venueError } = await supabase
    .from('venues')
    .select('claimed_until')
    .eq('id', venueId)
    .limit(1)

  if (venueError) {
    return NextResponse.json({ success: false, reason: 'Failed to fetch venue' }, { status: 500 })
  }
  if (!venueData || venueData.length === 0) {
    return NextResponse.json({ success: false, reason: 'Venue not found' }, { status: 404 })
  }

  const currentClaimedUntil = venueData[0].claimed_until

  // Compute new expiry
  const now = new Date()
  let baseDate: Date
  if (currentClaimedUntil && new Date(currentClaimedUntil) > now) {
    baseDate = new Date(currentClaimedUntil)
  } else {
    baseDate = now
  }
  const newExpiry = new Date(baseDate.getTime() + term * 24 * 60 * 60 * 1000)

  // Update venue: claimed_until + claim_contact_email
  const { error: updateVenueError } = await supabase
    .from('venues')
    .update({
      claimed_until: newExpiry.toISOString(),
      claim_contact_email: claimReq.email,
    })
    .eq('id', venueId)

  if (updateVenueError) {
    return NextResponse.json({ success: false, reason: 'Failed to update venue' }, { status: 500 })
  }

  // Revoke all prior tokens
  try {
    await revokeVenueTokens(venueId)
  } catch (e) {
    console.error('revokeVenueTokens error:', e)
    return NextResponse.json({ success: false, reason: 'Failed to revoke old tokens' }, { status: 500 })
  }

  // Generate new token
  let rawToken: string
  try {
    rawToken = await generateVenueToken(venueId, newExpiry)
  } catch (e) {
    console.error('generateVenueToken error:', e)
    return NextResponse.json({ success: false, reason: 'Failed to generate access link' }, { status: 500 })
  }

  // Update claim request status to 'verified'
  const { error: updateReqError } = await supabase
    .from('claim_requests')
    .update({ status: 'verified' })
    .eq('id', request_id)

  if (updateReqError) {
    console.error('claim_request update error:', updateReqError)
  }

  return NextResponse.json({
    success: true,
    url: `https://www.pourlist.app/claim/${rawToken}`,
    expires: newExpiry.toISOString(),
  })
}
