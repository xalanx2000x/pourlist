/**
 * Checks if a venue's structured HH schedule is currently active.
 *
 * Uses hh_type, hh_day, hh_start, hh_end (and _2 variants) to determine
 * if the current day/time falls within an active happy hour window.
 *
 * Falls back to hhTime (string) for venues that haven't been migrated yet.
 */
import type { Venue } from '@/lib/supabase'

// Default bar closing time (2 AM) — used when endMin is null for late_night windows
// Most US states mandate 2 AM or earlier; some cities/districts vary but 2 AM is the safest default
const CLOSE_DEFAULT = 2 * 60 // 120 mins = 2:00 AM

function minsSinceMidnight(): number {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

function currentISOWeekday(): number {
  // ISO: 1=Mon ... 7=Sun
  const dow = new Date().getDay() // 0=Sun ... 6=Sat
  return dow === 0 ? 7 : dow
}

/**
 * Returns true if the given HH window is active right now.
 */
function isWindowActive(
  type: string | null | undefined,
  day: number | null | undefined,
  startMin: number | null | undefined,
  endMin: number | null | undefined
): boolean {
  if (!type) return false

  const now = new Date()
  const currentDay = currentISOWeekday()
  const currentMin = minsSinceMidnight()

  // Day check — if hh_day is set, today must match
  if (day !== null && day !== undefined && day !== currentDay) {
    return false
  }

  switch (type) {
    case 'all_day':
      return true

    case 'open_through':
      // No start time (venue open), ends at endMin
      if (endMin === null || endMin === undefined) return false
      return currentMin < endMin

    case 'late_night':
      // Starts at startMin, ends at CLOSE_DEFAULT (2 AM) or venue close
      if (startMin === null || startMin === undefined) return false
      const end = endMin ?? CLOSE_DEFAULT
      if (startMin > end) {
        // Crosses midnight: active if currentMin >= start OR currentMin < end
        return currentMin >= startMin || currentMin < end
      }
      return currentMin >= startMin && currentMin < end

    case 'typical':
      if (startMin === null || startMin === undefined) return false
      if (endMin === null || endMin === undefined) return false
      // Handle late-night crossing midnight (e.g. 22:00-02:00)
      if (startMin > endMin) {
        // Crosses midnight: active if currentMin >= start OR currentMin < end
        return currentMin >= startMin || currentMin < endMin
      }
      return currentMin >= startMin && currentMin < endMin

    default:
      return false
  }
}

export function hasActiveHappyHour(venue: Partial<Venue>): boolean {
  // Structured fields (primary) — migrated venues
  const type = venue.hh_type as string | null | undefined
  if (type) {
    const active1 = isWindowActive(
      type,
      venue.hh_day as number | null | undefined,
      venue.hh_start as number | null | undefined,
      venue.hh_end as number | null | undefined
    )
    if (active1) return true

    // Window 2
    const type2 = venue.hh_type_2 as string | null | undefined
    if (type2) {
      const active2 = isWindowActive(
        type2,
        venue.hh_day_2 as number | null | undefined,
        venue.hh_start_2 as number | null | undefined,
        venue.hh_end_2 as number | null | undefined
      )
      if (active2) return true
    }

    return false
  }

  // Legacy fallback: hh_time string — venues not yet migrated
  const hhTime = venue.hh_time as string | null | undefined
  if (hhTime && hhTime.trim().length > 0) return true

  return false
}
