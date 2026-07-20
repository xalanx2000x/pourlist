import { NextRequest, NextResponse } from 'next/server'
import { checkSeedPassword, isSeedPasswordConfigured, setSeedAuthCookie } from '@/lib/seed-auth'

/**
 * POST /api/seed/login
 *
 * Body: { password: string }
 *
 * Verifies submitted password against SEED_PASSWORD (server-only env).
 * On match, sets an httpOnly cookie with an HMAC token signed by SEED_PASSWORD.
 * The password itself is NEVER stored in the cookie.
 *
 * Returns:
 *   { success: true } — cookie set
 *   { success: false, reason: 'invalid_password' } — wrong password (also returned when env not set)
 *   { success: false, reason: 'server_misconfigured' } — SEED_PASSWORD not set
 *   { success: false, reason: 'missing_password' } — body empty
 *
 * Note: we intentionally do not distinguish "wrong password" from "env not set"
 * to avoid leaking server config to a probing attacker.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { password?: unknown } | null
    const password = typeof body?.password === 'string' ? body.password : null

    if (!password || password.length === 0) {
      return NextResponse.json(
        { success: false, reason: 'missing_password' },
        { status: 400 }
      )
    }

    if (!isSeedPasswordConfigured()) {
      // Log so Tyler sees the config issue in server logs without leaking the
      // env var itself.
      console.error('[seed/login] SEED_PASSWORD env var is not set')
      return NextResponse.json(
        { success: false, reason: 'server_misconfigured' },
        { status: 500 }
      )
    }

    const ok = await checkSeedPassword(password)
    if (!ok) {
      return NextResponse.json(
        { success: false, reason: 'invalid_password' },
        { status: 401 }
      )
    }

    await setSeedAuthCookie()
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[seed/login] error:', err)
    return NextResponse.json(
      { success: false, reason: 'server_error' },
      { status: 500 }
    )
  }
}