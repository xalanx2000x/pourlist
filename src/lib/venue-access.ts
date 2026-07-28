/**
 * Server-only: venue owner access token + cookie layer.
 *
 * Raw tokens: generated with crypto.randomBytes(32).toString('base64url').
 * Stored as SHA-256 hex digest — never the raw token, never logged.
 *
 * Cookie: HMAC-SHA256 over venueId + expiry timestamp.
 * The signed payload carries the venue_id so the cookie authorizes exactly one venue.
 * Expiry is embedded in the cookie and verified on every check — not just at redemption.
 *
 * Security invariants (non-negotiable):
 *   - Raw token is returned once from generateVenueToken and never stored or logged
 *   - Token comparison is always timing-safe
 *   - Cookie is valid for exactly one venue_id — venue A's cookie cannot act on venue B
 *   - Expiry checked on every checkVenueAccess call
 */
import 'server-only'
import { cookies } from 'next/headers'
import crypto from 'crypto'
import { supabaseServer } from '@/lib/supabase-server'

const COOKIE_NAME = 'venue_access'

function getSeedPassword(): string | null {
  const pwd = process.env.SEED_PASSWORD
  return pwd && pwd.length > 0 ? pwd : null
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8')
  const bBuf = Buffer.from(b, 'utf8')
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf)
    return false
  }
  return crypto.timingSafeEqual(aBuf, bBuf)
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function signPayload(payload: string): string {
  const password = getSeedPassword()
  if (!password) throw new Error('SEED_PASSWORD not set')
  return crypto.createHmac('sha256', password).update(payload).digest('hex')
}

/**
 * Generate a one-time venue access token.
 * Stores the SHA-256 hash; returns the raw token once, never to be stored.
 */
export async function generateVenueToken(
  venueId: string,
  expiresAt: Date
): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('base64url')
  const tokenHash = hashToken(rawToken)

  const { error } = await supabaseServer
    .from('venue_access_tokens')
    .insert({
      venue_id:   venueId,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    })

  if (error) throw new Error(`Failed to store token: ${error.message}`)

  return rawToken
}

/**
 * Verify a raw token against the stored hash.
 * Returns the venue_id if valid, un-revoked, and un-expired.
 * Tokens are reusable until expiry — not consumed on success.
 */
export async function verifyVenueToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(token)

  const { data } = await supabaseServer
    .from('venue_access_tokens')
    .select('venue_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .limit(1)

  if (!data || data.length === 0) return null

  const row = data[0]

  // revoked check
  if (row.revoked_at !== null) return null

  // expiry check
  if (new Date(row.expires_at) <= new Date()) return null

  return row.venue_id
}

/**
 * Set the venue_access cookie after token has been verified.
 * Cookie value: venueId.expiresAt.toISOString().HMAC
 * HMAC is over venueId + expiry so neither can be altered independently.
 */
export async function setVenueAccessCookie(
  venueId: string,
  expiresAt: Date
): Promise<void> {
  const password = getSeedPassword()
  if (!password) throw new Error('SEED_PASSWORD not set')

  const expiryStr = expiresAt.toISOString()
  const payload = `${venueId}.${expiryStr}`
  const signature = crypto
    .createHmac('sha256', password)
    .update(payload)
    .digest('hex')

  const cookieValue = `${payload}.${signature}`
  const maxAge = Math.floor((expiresAt.getTime() - Date.now()) / 1000)

  const cookieStore = await cookies()
  cookieStore.set({
    name: COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  })
}

/**
 * Read and verify the venue_access cookie.
 * Returns the authorized venue_id if the signature is valid and the embedded
 * expiry has not passed. Returns null for any tampering, missing cookie,
 * or expired session.
 */
export async function checkVenueAccess(): Promise<string | null> {
  const password = getSeedPassword()
  if (!password) return null

  const cookieStore = await cookies()
  const raw = cookieStore.get(COOKIE_NAME)?.value
  if (!raw) return null

  const parts = raw.split('.')
  if (parts.length < 3) return null

  // parts[0] = venueId, parts[1..n-2] = expiryStr (may have encoded : in it), parts[n-1] = signature
  const venueId = parts[0]
  const signature = parts[parts.length - 1]
  // Re-join the middle parts as expiryStr, then decode so %3A → : etc.
  const expiryStr = decodeURIComponent(parts.slice(1, -1).join('.'))

  // Re-compute HMAC over venueId + expiry and compare timing-safe
  const payload = `${venueId}.${expiryStr}`
  const expectedSig = crypto
    .createHmac('sha256', password)
    .update(payload)
    .digest('hex')

  if (!timingSafeStringEqual(signature, expectedSig)) return null

  // Expiry check — embedded in the cookie, verified on every call
  if (new Date(expiryStr) <= new Date()) return null

  return venueId
}

/**
 * Revoke all outstanding tokens for a venue.
 * Sets revoked_at = now() on all non-revoked tokens.
 */
export async function revokeVenueTokens(venueId: string): Promise<void> {
  const { error } = await supabaseServer
    .from('venue_access_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('venue_id', venueId)
    .is('revoked_at', null)

  if (error) throw new Error(`Failed to revoke tokens: ${error.message}`)
}
