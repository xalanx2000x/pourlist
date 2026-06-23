import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST /api/log-parse-failure
 * Body: { deviceHash: string, failureType: string, rawText: string, error?: string, metadata?: object }
 * failureType values:
 *   'hh_blocked_input'  — user HH text the parser couldn't interpret (block point)
 *   'hh_recovery'        — user succeeded after a blocked attempt (failed → succeeded pair)
 *   'gpt_image'          — GPT failed to read menu photo (parked feature; kept for future)
 * Writes a parse_failure event to the events table for dashboard analysis.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { deviceHash, failureType, rawText, error, metadata } = body

    if (!deviceHash || typeof deviceHash !== 'string') {
      return NextResponse.json({ error: 'deviceHash required' }, { status: 400 })
    }
    if (!failureType || typeof failureType !== 'string') {
      return NextResponse.json({ error: 'failureType required' }, { status: 400 })
    }

    const { error: insertError } = await supabase.from('events').insert({
      event_name: 'parse_failure',
      device_hash: deviceHash,
      metadata: {
        failureType: failureType ?? null,
        rawText: typeof rawText === 'string' ? rawText : null,
        error: typeof error === 'string' ? error : null,
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
      },
    })

    if (insertError) {
      console.error('log-parse-failure insert error:', insertError)
      return NextResponse.json({ error: 'Insert failed' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('log-parse-failure route error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
