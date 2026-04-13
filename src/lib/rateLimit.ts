/**
 * Client-side rate limiter for menu submissions.
 * Allows unlimited submissions for the first UNLIMITED_WINDOW_MS after first submission,
 * then limits to one per THROTTLE_MS thereafter.
 *
 * This is a UX convenience — prevents angry用户在失误后无法立即重试，
 * while discouraging automated spam from casual misuse.
 * Tamper-savvy users can bypass it, but that's not our threat model.
 */
const UNLIMITED_WINDOW_MS = 2 * 60 * 1000  // 2 minutes
const THROTTLE_MS = 2 * 60 * 1000           // 1 per 2 minutes after

export interface RateLimitState {
  allowed: boolean
  retryAfterMs?: number
}

export function checkRateLimit(deviceHash: string): RateLimitState {
  try {
    const key = `pourlist_submit_${deviceHash}`
    const raw = localStorage.getItem(key)

    if (!raw) {
      // First submission ever — set timestamp and allow
      localStorage.setItem(key, String(Date.now()))
      return { allowed: true }
    }

    const timestamp = parseInt(raw, 10)
    const elapsed = Date.now() - timestamp

    if (elapsed < UNLIMITED_WINDOW_MS) {
      // Still in unlimited window — allow and refresh timestamp
      localStorage.setItem(key, String(Date.now()))
      return { allowed: true }
    }

    if (elapsed >= THROTTLE_MS) {
      // Outside throttle window — allow and refresh
      localStorage.setItem(key, String(Date.now()))
      return { allowed: true }
    }

    // Inside throttle window — blocked
    return {
      allowed: false,
      retryAfterMs: THROTTLE_MS - elapsed
    }
  } catch {
    // localStorage unavailable — allow (fail open, don't block the user)
    return { allowed: true }
  }
}