/**
 * POST /api/claim-request
 *
 * Submit a venue ownership / claiming inquiry.
 * No auth required. Spam guard: duplicate within 24h silently returns a friendly
 * JSON "already received" response (not an error). Hidden honeypot field rejects
 * bot submissions.
 *
 * Errors are always JSON with a `reason` field — never a bare throw.
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase-server'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(req: NextRequest) {
  let body: Record<string, string>
  try {
    const parsed = await req.json()
    if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object')
    body = parsed as Record<string, string>
  } catch {
    return json({ reason: 'Invalid request body' }, 400)
  }

  // ── Honeypot check ────────────────────────────────────────────────────────────
  // Bots fill this hidden field; humans never see it.
  if (body._trap) {
    // Silently succeed — don't tell the bot anything failed.
    return json({ ok: true })
  }

  // ── Field validation ─────────────────────────────────────────────────────────
  const { venue_id, contact_name, phone, email, note } = body

  if (!venue_id || typeof venue_id !== 'string') {
    return json({ reason: 'venue_id is required' }, 400)
  }
  if (!contact_name || typeof contact_name !== 'string' || contact_name.trim().length === 0) {
    return json({ reason: 'contact_name is required' }, 400)
  }
  if (!phone || typeof phone !== 'string' || phone.trim().length === 0) {
    return json({ reason: 'phone is required' }, 400)
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return json({ reason: 'A valid email address is required' }, 400)
  }
  if (note && (typeof note !== 'string' || note.length > 280)) {
    return json({ reason: 'Note must be 280 characters or fewer' }, 400)
  }

  // ── Venue exists check + fetch name for notification email ──────────────────
  const { data: venue, error: venueError } = await supabaseServer
    .from('venues')
    .select('id, name')
    .eq('id', venue_id)
    .single()

  if (venueError || !venue) {
    return json({ reason: 'Venue not found' }, 404)
  }

  // ── Duplicate check (spam guard) ───────────────────────────────────────────────
  // Reject if this venue already received a request in the last 24 hours.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await supabaseServer
    .from('claim_requests')
    .select('id')
    .eq('venue_id', venue_id)
    .gte('created_at', yesterday)
    .limit(1)

  if ((recent?.length ?? 0) > 0) {
    // Friendly response — not an error, just "we already got one"
    return json({
      alreadyReceived: true,
      message: "We've already got your request — we'll be in touch.",
    })
  }

  // ── Insert ──────────────────────────────────────────────────────────────────
  const { error: insertError } = await supabaseServer
    .from('claim_requests')
    .insert({
      venue_id,
      contact_name: contact_name.trim(),
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      note: note?.trim() ?? null,
    })

  if (insertError) {
    console.error('claim_request insert error:', insertError)
    return json({ reason: 'Failed to submit request — please try again.' }, 500)
  }

  // ── Notification email (fire-and-forget) ─────────────────────────────────────
  // Fetch venue name if not already loaded
  let venueName: string | null = null
  if (venue && 'name' in venue) {
    venueName = (venue as { name?: string }).name ?? null
  }
  if (!venueName) {
    // Defer a background name lookup — don't block the user response
    const { data: nameRow } = await supabaseServer
      .from('venues')
      .select('name')
      .eq('id', venue_id)
      .limit(1)
    venueName = nameRow?.[0]?.name ?? null
  }

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'onboarding@resend.dev',
        to: 'xalanx2000x@gmail.com',
        subject: `New claim request: ${venueName ?? 'Unknown venue'}`,
        text: `New claim request:\n\nVenue: ${venueName ?? 'Unknown venue'}\nContact: ${contact_name}\nPhone: ${phone}\nEmail: ${email}\n\nView in /verification: https://www.pourlist.app/verification`,
      }),
    })
  } catch (err) {
    console.error('Resend notification failed:', err)
  }

  return json({
    ok: true,
    message: "Got it — we'll call your venue's listed number within 3 business days.",
  })
}
