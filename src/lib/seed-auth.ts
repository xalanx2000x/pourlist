import { cookies } from 'next/headers'
import crypto from 'crypto'

/**
 * Server-only helpers for /seed tool auth.
 *
 * The SEED_PASSWORD env var is NEVER exposed to the client. The client only
 * sends the password once at /api/seed/login; if it matches, the server sets
 * an httpOnly cookie containing an HMAC-derived token signed with
 * SEED_PASSWORD. Subsequent requests verify the cookie, not the password.
 *
 * Standing rule: SEED_PASSWORD is server-only. Never print it. Never
 * expose as NEXT_PUBLIC_. Never compare in client code.
 */

const COOKIE_NAME = 'seed_session'
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 7 // 7 days
const TOKEN_VERSION = 'seed_session_v1'

function getSeedPassword(): string | null {
  const pwd = process.env.SEED_PASSWORD
  return pwd && pwd.length > 0 ? pwd : null
}

/**
 * Derive the cookie token from SEED_PASSWORD using HMAC-SHA256.
 * The token is the only thing the client carries. Forging requires
 * knowing SEED_PASSWORD, which is server-only.
 */
function signToken(password: string): string {
  return crypto.createHmac('sha256', password).update(TOKEN_VERSION).digest('hex')
}

/**
 * Compare two strings in constant time.
 * Used for both password compare (login) and token compare (verify).
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) {
    // Length mismatch still consumes time via the buffer compare on equal-length
    // scratch buffers, preserving constant-time behavior across length diffs.
    crypto.timingSafeEqual(aBuf, aBuf)
    return false
  }
  return crypto.timingSafeEqual(aBuf, bBuf)
}

/**
 * Check the current request's cookie against SEED_PASSWORD.
 * Returns true iff SEED_PASSWORD is set AND the cookie's HMAC matches.
 */
export async function checkSeedAuth(): Promise<boolean> {
  const password = getSeedPassword()
  if (!password) return false
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return false
  return timingSafeStringEqual(token, signToken(password))
}

/**
 * Issue a fresh signed cookie. Caller must have already verified the password.
 */
export async function setSeedAuthCookie(): Promise<void> {
  const password = getSeedPassword()
  if (!password) throw new Error('SEED_PASSWORD not set')
  const cookieStore = await cookies()
  cookieStore.set({
    name: COOKIE_NAME,
    value: signToken(password),
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_S,
    path: '/',
  })
}

/**
 * Clear the session cookie (logout).
 */
export async function clearSeedAuthCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}

/**
 * Constant-time compare of a submitted password against SEED_PASSWORD.
 * Returns false if SEED_PASSWORD is unset (so login is impossible rather than
 * silently authenticating everyone when env is missing).
 */
export async function checkSeedPassword(submitted: string | undefined | null): Promise<boolean> {
  const password = getSeedPassword()
  if (!password) return false
  if (typeof submitted !== 'string' || submitted.length === 0) return false
  return timingSafeStringEqual(submitted, password)
}

/**
 * Reports whether SEED_PASSWORD is configured. Used by the login form to
 * show a clear "server misconfigured" message instead of generic "wrong password".
 */
export function isSeedPasswordConfigured(): boolean {
  return getSeedPassword() !== null
}