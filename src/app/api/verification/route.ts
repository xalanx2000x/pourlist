/**
 * /api/verification — admin work page for claim requests.
 *
 * GET  — list all claim requests, joined with venues(name, city, state, phone)
 * PATCH — update status and/or admin_note on a claim request
 *
 * Auth: checkSeedAuth() via seed_session HMAC cookie.
 * Same pattern as /api/seed/* routes.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkSeedAuth } from '@/lib/seed-auth'

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
