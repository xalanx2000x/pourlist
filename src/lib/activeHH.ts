/**
 * Checks if a venue's structured HH schedule is currently active.
 *
 * Handles 3 windows with:
 * - Comma-separated ISO weekday lists (e.g. "1,2,3,4,5" = Mon-Fri)
 * - Day exclusions (e.g. "daily except Tue" = hh_days="1,2,3,4,5,6,7", hh_exclude_days="3")
 * - all_day: constrained by venue's opening_min + city's closeMin from bar-close-times.ts
 * - open_through: endMin defaults to city's closeMin
 * - late_night: endMin defaults to city's closeMin (bar close)
 * - typical: explicit start/end times required
 *
 * Falls back to hhTime (string) for venues not yet migrated.
 */
import type { Venue } from '@/lib/supabase'
import { getCityCloseMin } from '@/lib/bar-close-times'

/**
 * Checks if a legacy hh_time string (e.g. "4-6pm", "4pm - 7pm") represents
 * an active happy hour right now.
 *
 * Uses heuristics for bare numbers like "4-6":
 * - If endHour <= 4: assumes AM/PM pair (e.g. "4-6" = 4pm-6pm)
 * - Otherwise uses current hour context (assumes PM if startHour < currentHour)
 *
 * Returns false if the string can't be parsed or the current time
 * is outside the window.
 */
function isLegacyHhTimeActive(hhTime: string): boolean {
  const currentHour = new Date().getHours()

  // Pattern: "4-6", "4pm-6pm", "4 pm - 7 pm", "5 to 8", etc.
  const timeWindowMatch = hhTime.match(
    /\b(\d{1,2})\s*[-–—to]+\s*(\d{1,2})(pm|am)?\b/i
  )
  if (!timeWindowMatch) return false

  let startHour = parseInt(timeWindowMatch[1])
  let endHour = parseInt(timeWindowMatch[2])
  const suffix = timeWindowMatch[3]?.toLowerCase()

  if (suffix === 'am' && endHour < 12) endHour += 12
  if (suffix === 'pm' && startHour < 12) startHour += 12

  // Bare number heuristic: if no suffix and endHour < current hour reference,
  // assume PM (typical HH like "4-6" = 4pm-6pm, not 4am-6am)
  if (!suffix && endHour < 12) {
    // If endHour <= currentHour reference point, assume PM times
    if (endHour <= 4) {
      // Very early end (e.g. "4-6" with endHour=6) → 4pm-6pm
      startHour += 12
      endHour += 12
    } else if (endHour > startHour) {
      // Normal range like 4-7 with no suffix: assume PM
      if (startHour < 12) startHour += 12
      if (endHour < 12) endHour += 12
    }
    // else: ambiguous, leave as-is
  }

  // Handle midnight crossing (e.g. "10pm-2am")
  if (endHour < startHour) {
    return currentHour >= startHour || currentHour < endHour
  }

  return currentHour >= startHour && currentHour < endHour
}

const CLOSE_DEFAULT = 2 * 60 // 2:00 AM in minutes since midnight

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
 * Parse a comma-separated ISO weekday string into an array of numbers.
 * "1,2,3,4,5" → [1, 2, 3, 4, 5]
 * "1,2,3,4,5,6,7" → [1, 2, 3, 4, 5, 6, 7]
 * "" → []
 */
function parseDays(daysStr: string | null | undefined): number[] {
  if (!daysStr || !daysStr.trim()) return []
  return daysStr.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 7)
}

/**
 * Parse exclusion days (same format as parseDays).
 */
function parseExcludeDays(exclStr: string | null | undefined): number[] {
  return parseDays(exclStr)
}

/**
 * Check if a day matches the HH day criteria.
 * - If days is empty → applies to all days
 * - If days has values → current ISO weekday must be in the list
 * - If excludeDays has values → current ISO weekday must NOT be in the exclusion list
 */
function isDayActive(days: number[], excludeDays: number[]): boolean {
  const today = currentISOWeekday()

  if (excludeDays.length > 0 && excludeDays.includes(today)) return false

  if (days.length === 0) return true  // no restriction — applies to all days
  return days.includes(today)
}

/**
 * Get the effective end minute for a window.
 * - If endMin is set → use it
 * - If null and type is open_through or late_night → use city closeMin
 * - If null and type is all_day → use city closeMin
 * - Otherwise → null (open-ended)
 */
function getEffectiveEndMin(
  endMin: number | null | undefined,
  type: string | null | undefined,
  venueState: string | null | undefined
): number | null {
  if (endMin !== null && endMin !== undefined) return endMin
  if (type === 'open_through' || type === 'late_night' || type === 'all_day') {
    const cityClose = getCityCloseMin('', venueState ?? '')
    return cityClose ?? CLOSE_DEFAULT
  }
  return null
}

/**
 * Check if a single HH window is active right now.
 */
function isWindowActive(
  type: string | null | undefined,
  daysStr: string | null | undefined,
  excludeDaysStr: string | null | undefined,
  startMin: number | null | undefined,
  endMin: number | null | undefined,
  openingMin: number | null | undefined,
  venueState: string | null | undefined
): boolean {
  if (!type) return false

  const days = parseDays(daysStr)
  const excludeDays = parseExcludeDays(excludeDaysStr)

  // Day check
  if (!isDayActive(days, excludeDays)) return false

  const currentMin = minsSinceMidnight()
  const effectiveEndMin = getEffectiveEndMin(endMin, type, venueState)

  switch (type) {
    case 'all_day': {
      // HH runs from venue open to bar close
      const start = openingMin ?? (14 * 60)  // default 2pm if opening_min not set
      return currentMin >= start && currentMin < (effectiveEndMin ?? CLOSE_DEFAULT)
    }

    case 'open_through':
      // No explicit start (venue open), ends at effectiveEndMin
      if (effectiveEndMin === null) return false
      return currentMin < effectiveEndMin

    case 'late_night':
      // Starts at startMin, ends at effectiveEndMin
      if (startMin === null || startMin === undefined) return false
      const end = effectiveEndMin ?? CLOSE_DEFAULT
      if (startMin > end) {
        // Crosses midnight: active if currentMin >= startMin OR currentMin < end
        return currentMin >= startMin || currentMin < end
      }
      return currentMin >= startMin && currentMin < end

    case 'typical':
      // Explicit start + end required
      if (startMin === null || startMin === undefined) return false
      if (effectiveEndMin === null) return false
      // Handle midnight crossing (e.g. 22:00-02:00)
      if (startMin > effectiveEndMin) {
        return currentMin >= startMin || currentMin < effectiveEndMin
      }
      return currentMin >= startMin && currentMin < effectiveEndMin

    default:
      return false
  }
}

/**
 * Returns true if the venue's happy hour is currently active.
 *
 * Checks up to 3 windows (window 1, 2, 3). If any window is active, returns true.
 * Falls back to hh_time string for venues not yet migrated.
 */
export function hasActiveHappyHour(venue: Partial<Venue>): boolean {
  // Read opening_min from venue (minutes since midnight venue opens)
  const openingMin = venue.opening_min as number | null | undefined

  // Window 1
  const type = venue.hh_type as string | null | undefined
  if (type) {
    const active1 = isWindowActive(
      type,
      venue.hh_days as string | null | undefined,
      venue.hh_exclude_days as string | null | undefined,
      venue.hh_start as number | null | undefined,
      venue.hh_end as number | null | undefined,
      openingMin,
      null  // TODO: derive state from venue GPS for city-specific close times
    )
    if (active1) return true

    // Window 2
    const type2 = venue.hh_type_2 as string | null | undefined
    if (type2) {
      const active2 = isWindowActive(
        type2,
        venue.hh_days_2 as string | null | undefined,
        venue.hh_exclude_days_2 as string | null | undefined,
        venue.hh_start_2 as number | null | undefined,
        venue.hh_end_2 as number | null | undefined,
        openingMin,
        null
      )
      if (active2) return true
    }

    // Window 3
    const type3 = venue.hh_type_3 as string | null | undefined
    if (type3) {
      const active3 = isWindowActive(
        type3,
        venue.hh_days_3 as string | null | undefined,
        venue.hh_exclude_days_3 as string | null | undefined,
        venue.hh_start_3 as number | null | undefined,
        venue.hh_end_3 as number | null | undefined,
        openingMin,
        null
      )
      if (active3) return true
    }

    return false
  }

  // Legacy fallback: hh_time string — actually evaluate the time
  const hhTime = venue.hh_time as string | null | undefined
  if (hhTime && hhTime.trim().length > 0) {
    return isLegacyHhTimeActive(hhTime.trim())
  }

  return false
}

/**
 * Format minutes since midnight as a human-readable time string.
 * e.g. 960 → "4:00 PM", 1380 → "11:00 PM"
 */
export function formatMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const period = h < 12 ? 'AM' : 'PM'
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`
}