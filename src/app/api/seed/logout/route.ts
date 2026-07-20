import { NextResponse } from 'next/server'
import { clearSeedAuthCookie } from '@/lib/seed-auth'

/**
 * POST /api/seed/logout
 *
 * Clears the seed_session cookie. Always succeeds; clients treat
 * the response as definitive.
 */
export async function POST() {
  await clearSeedAuthCookie()
  return NextResponse.json({ success: true })
}