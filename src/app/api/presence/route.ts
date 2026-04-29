/**
 * POST /api/presence
 * Body: { deviceHash: string; sessionId: string }
 * Fire-and-forget presence ping — always returns 200.
 * Uses Supabase service role key for server-side write.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { deviceHash, sessionId } = await req.json()

    if (!deviceHash || !sessionId) {
      return NextResponse.json({ ok: true })
    }

    // Fire-and-forget — don't await
    supabase
      .from('presence')
      .upsert({
        device_hash: deviceHash,
        session_id: sessionId,
        last_seen: new Date().toISOString(),
      })
      .then(() => {}, () => {})

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: true })
  }
}