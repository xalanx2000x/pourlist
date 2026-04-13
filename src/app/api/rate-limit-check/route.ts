import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/rate-limit-check
 * Body: { action: string, deviceHash: string }
 *
 * Uses the SUPABASE_SERVICE_ROLE_KEY so it can read/write the
 * rate_limits table without Row Level Security interference.
 *
 * Rate limit windows:
 *   upload-photo : 10 per hour
 *   submit-menu  : 20 per hour
 *   parse-menu   : 30 per hour
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, deviceHash } = body as { action: string; deviceHash: string }

    if (!action || !deviceHash) {
      return NextResponse.json(
        { error: 'action and deviceHash are required' },
        { status: 400 }
      )
    }

    const allowedActions = ['submit-menu', 'upload-photo', 'parse-menu']
    if (!allowedActions.includes(action)) {
      return NextResponse.json(
        { error: `Unknown action: ${action}` },
        { status: 400 }
      )
    }

    // Limit deviceHash to a sane length to prevent abuse
    if (deviceHash.length > 128) {
      return NextResponse.json(
        { error: 'Invalid deviceHash' },
        { status: 400 }
      )
    }

    // Build the admin Supabase client using the service role key
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Determine limit params per action
    const limits: Record<string, [maxRequests: number, windowSeconds: number]> = {
      'upload-photo': [10, 3600],   // 10 uploads per hour
      'submit-menu':  [20, 3600],   // 20 submits per hour
      'parse-menu':   [30, 3600],   // 30 parses per hour
    }
    const [maxRequests, windowSeconds] = limits[action]

    // Call the Postgres function
    const { data, error } = await supabaseAdmin.rpc('check_rate_limit', {
      p_device_hash:   deviceHash,
      p_action:        action,
      p_max_requests:  maxRequests,
      p_window_seconds: windowSeconds,
    })

    if (error) {
      console.error('[rate-limit-check] RPC error:', error)
      // Fail open — don't block users because of a DB error
      return NextResponse.json({ allowed: true })
    }

    return NextResponse.json({ allowed: data as boolean })
  } catch (err: unknown) {
    console.error('[rate-limit-check] Unexpected error:', err)
    // Fail open on any error
    return NextResponse.json({ allowed: true })
  }
}
