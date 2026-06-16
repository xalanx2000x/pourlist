/**
 * Share helpers for venue cards and detail views.
 *
 * Pure / browser-safe — no React, no DOM. The single browser API
 * call (Web Share + clipboard) is gated on `typeof navigator` so
 * this file is safe to import from Server Components too.
 */
import type { Venue } from './supabase'
import { venueSlug } from './slug'
import { getHhLabel } from './format-schedule'

// Source of truth = env var. Fallback keeps the module loadable in
// environments where the env hasn't been set (tests, scripts).
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://pourlist.app'

/**
 * Build the public URL for a venue. Always resolves, even if the slug
 * backfill hasn't reached this row yet — `venueSlug()` falls back to
 * a stable computed slug from `name + uuid-prefix`.
 */
export function venueShareUrl(venue: { slug: string | null; name: string | null; id: string }): string {
  return `${BASE_URL}/venue/${venueSlug(venue)}`
}

/**
 * Summarize the venue's deal/menu text into a short snippet for the
 * share message. Returns '' if there's no menu text so the caller can
 * omit the clause without printing "undefined".
 *
 * Heuristic: take the first non-empty line (most OCR'd menus are
 * line-per-deal), trim, cap at 140 chars with an ellipsis if longer.
 */
export function dealSummary(venue: { menu_text: string | null }): string {
  if (!venue.menu_text) return ''
  const firstLine = venue.menu_text
    .split('\n')
    .map(l => l.trim())
    .find(l => l.length > 0) ?? ''
  if (!firstLine) return ''
  if (firstLine.length <= 140) return firstLine
  return firstLine.slice(0, 137).trimEnd() + '…'
}

/**
 * Build a human-readable schedule string. Returns '' when the venue
 * has nothing — structured windows, legacy `hh_time`, and
 * `hh_summary` are all checked in priority order.
 */
export function scheduleSummary(venue: Venue): string {
  return getHhLabel(venue) ?? venue.hh_time ?? ''
}

/**
 * Build the share text body. Never prints "undefined" — the deal and
 * schedule parts are filtered out if empty.
 *
 * If `url` is provided, it is appended on a new line. The URL lives in
 * the text body itself (not just in a separate `url` field) so it
 * survives the Web Share API path to SMS / iMessage, which drops the
 * `url` field and only delivers `text`. Mail and WhatsApp still get a
 * clickable link because we also pass the `url` field through — but
 * the text-body copy is the canonical delivery path.
 *
 *   both:   "🍸 Happy hour at Matador — $5 wells, Daily 4–6 PM. See it live on PourList:\nhttps://pourlist.app/venue/matador-060fe1"
 *   deal:   "🍸 Happy hour at Matador — $5 wells. See it live on PourList:\nhttps://…"
 *   sched:  "🍸 Happy hour at Matador — Daily 4–6 PM. See it live on PourList:\nhttps://…"
 *   neither:"🍸 Happy hour at Matador. See it live on PourList:\nhttps://…"
 */
export function buildShareText(venue: Venue, url?: string): string {
  const deal = dealSummary(venue)
  const schedule = scheduleSummary(venue)
  const middle = [deal, schedule].filter(s => s.length > 0).join(', ')
  const middlePhrase = middle ? ` — ${middle}` : ''
  const body = `🍸 Happy hour at ${venue.name}${middlePhrase}. See it live on PourList:`
  return url ? `${body}\n${url}` : body
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'error'

/**
 * Share a venue using the Web Share API on supported devices; fall
 * back to copying the link to the clipboard on desktop.
 *
 *   'shared'    — Web Share API succeeded
 *   'copied'    — Clipboard fallback used (caller should toast)
 *   'cancelled' — User dismissed the share sheet (no UI)
 *   'error'     — Both APIs failed (caller should toast)
 */
export async function shareVenue(venue: Venue): Promise<ShareResult> {
  const url = venueShareUrl(venue)
  // URL is embedded in the text body so SMS / iMessage recipients see
  // it even when the target app drops the separate `url` field. We
  // also pass `url` to navigator.share so apps that DO use the field
  // (Mail, WhatsApp) get a clickable preview.
  const text = buildShareText(venue, url)

  // Web Share API (iOS Safari, Android Chrome, supported desktop)
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: venue.name, text, url })
      return 'shared'
    } catch (e) {
      // AbortError = user dismissed the sheet — not an error.
      if (e instanceof DOMException && e.name === 'AbortError') {
        return 'cancelled'
      }
      // Anything else falls through to the clipboard fallback.
    }
  }

  // Clipboard fallback (desktop, or Web Share unavailable/failed)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return 'copied'
    } catch {
      // fall through
    }
  }

  return 'error'
}
