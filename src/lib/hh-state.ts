/**
 * HH timing color states for venue pins and list items.
 *
 * State priority (highest to lowest): active > hh_soon > hh_today > default
 */

import type { Venue } from '@/lib/supabase'

export type HHState = 'default' | 'hh_today' | 'hh_soon' | 'active'

// Colors matching the spec
const HH_COLORS: Record<HHState, string> = {
  default:   '#f97316',  // orange
  hh_today:  '#f97316',  // orange (outer ring)
  hh_soon:   '#a855f7',  // purple (outer ring)
  active:    '#a855f7',  // purple
}

export { HH_COLORS as HH_COLORS }

export function getHHColor(state: HHState): string {
  return HH_COLORS[state]
}

// ─── internal helpers ────────────────────────────────────────────────────────

function currentMinutes(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

/**
 * Convert JS Date day-of-week (0=Sun ... 6=Sat) to ISO weekday (1=Mon ... 7=Sun).
 */
function isoWeekday(d: Date): number {
  const dow = d.getDay() // 0=Sun
  return dow === 0 ? 7 : dow
}

/**
 * Parse a comma-separated ISO weekday string.
 * "1,2,3,4,5" → [1, 2, 3, 4, 5]
 */
function parseDays(daysStr: string | null | undefined): number[] {
  if (!daysStr || !daysStr.trim()) return []
  return daysStr.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 7)
}

type WindowDesc = {
  startMin: number | null | undefined
  endMin:   number | null | undefined
  days:     string | null | undefined
  type:     string | null | undefined
  endDefault: number // effective endMin fallback
}

/** Effective endMin for a window (or null if open-ended / not applicable). */
function effectiveEndMin(w: WindowDesc): number | null {
  if (w.endMin !== null && w.endMin !== undefined) return w.endMin
  if (w.type === 'late_night' || w.type === 'all_day') {
    return w.endDefault
  }
  return null
}

/** Returns true when the current time falls within this HH window (accounting for midnight crossing). */
function isInWindow(w: WindowDesc, currentMin: number): boolean {
  if (w.startMin === null || w.startMin === undefined) return false
  const end = effectiveEndMin(w)
  if (end === null) return false

  // Midnight crossing (e.g. 22:00–02:00)
  if (w.startMin > end) {
    return currentMin >= w.startMin || currentMin < end
  }
  return currentMin >= w.startMin && currentMin < end
}

/** Returns true when currentMin is within 60 minutes before the window starts. */
function isSoonWindow(w: WindowDesc, currentMin: number): boolean {
  if (w.startMin === null || w.startMin === undefined) return false
  return (w.startMin - 60) <= currentMin && currentMin < w.startMin
}

/** Returns true when the window is scheduled for today. */
function isTodayWindow(w: WindowDesc, todayISO: number): boolean {
  const days = parseDays(w.days)
  if (days.length === 0) return true // no restriction
  return days.includes(todayISO)
}

/**
 * Score a window by proximity to current time.
 * Returns Infinity if window is active, large number if soon, small number if far.
 * Lower = closer / higher priority.
 */
function windowScore(w: WindowDesc, currentMin: number): number {
  if (isInWindow(w, currentMin)) return 0              // active = highest priority
  if (isSoonWindow(w, currentMin)) return 60 - (w.startMin! - currentMin) // soon: 0–59
  // hh_today: use distance to start
  if (w.startMin === null || w.startMin === undefined) return 9999
  if (currentMin < w.startMin) return (w.startMin - currentMin) + 100  // upcoming today: 100–infty
  // started earlier today but not active (missed)
  return (currentMin - w.startMin) + 500 // past: low priority
}

// ─── public API ──────────────────────────────────────────────────────────────

/** Returns the highest-priority HH state for a venue. */
export function getHHState(venue: Partial<Venue>): HHState {
  const currentMin = currentMinutes()
  const todayISO = isoWeekday(new Date())

  const windows: WindowDesc[] = [
    {
      startMin:    venue.hh_start,
      endMin:      venue.hh_end,
      days:        venue.hh_days,
      type:        venue.hh_type,
      endDefault:  2 * 60, // 2am
    },
    {
      startMin:    venue.hh_start_2,
      endMin:      venue.hh_end_2,
      days:        venue.hh_days_2,
      type:        venue.hh_type_2,
      endDefault:  2 * 60,
    },
    {
      startMin:    venue.hh_start_3,
      endMin:      venue.hh_end_3,
      days:        venue.hh_days_3,
      type:        venue.hh_type_3,
      endDefault:  2 * 60,
    },
  ]

  // Score each window that applies today
  let bestScore = Infinity
  let bestState: HHState = 'default'

  for (const w of windows) {
    if (!isTodayWindow(w, todayISO)) continue

    const score = windowScore(w, currentMin)
    if (score < bestScore) {
      bestScore = score

      if (isInWindow(w, currentMin)) {
        bestState = 'active'
      } else if (isSoonWindow(w, currentMin)) {
        bestState = 'hh_soon'
      } else {
        bestState = 'hh_today'
      }
    }
  }

  // All windows in the past — no HH left today, fall back to default
  if (bestScore >= 500) {
    return 'default'
  }

  return bestState
}