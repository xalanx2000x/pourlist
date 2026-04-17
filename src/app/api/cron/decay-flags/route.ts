import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * POST /api/cron/decay-flags
 *
 * Called by OpenClaw cron job (monthly).
 * Runs flag decay: removes 1 flag per venue per month.
 *
 * Cron call example:
 *   curl -X POST https://yourdomain.com/api/cron/decay-flags
 *
 * No auth required — only callable by the cron scheduler.
 */
export async function POST(req: NextRequest) {
  try {
    // Optional: verify cron secret if configured
    const cronSecret = process.env.CRON_SECRET
    if (cronSecret) {
      const authHeader = req.headers.get('authorization')
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const { data, error } = await supabase.rpc('decay_flags')

    if (error) {
      console.error('decay_flags error:', error)
      return NextResponse.json({ error: 'Decay failed' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      flags_decayed: data ?? 0,
      message: `Decayed ${data ?? 0} flags`
    })
  } catch (err) {
    console.error('decay-flags cron error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
