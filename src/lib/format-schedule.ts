/**
 * Pure helpers for rendering a venue's happy-hour schedule as a
 * human-readable string. No React, no DOM, no 'use client' — safe
 * to import from Server Components (including the static venue
 * page) and from Client Components (the existing VenueDetail).
 *
 * Single source of truth for "Daily 4–6 PM · Daily 10 PM–midnight"-
 * style display text across the app.
 */
import type { Venue } from '@/lib/supabase'
import type { LeanVenue } from '@/lib/venues'
import { formatMin } from '@/lib/hh-state'

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Format a day range or list into a human-readable string.
 * [1, 2, 3, 4, 5] → "Mon–Fri"
 * [1, 3, 5] → "Mon, Wed, Fri"
 * [6, 7] → "Sat–Sun"
 * [1, 2, 3, 4, 5, 6, 7] → "Daily"
 * [1, 2, 3, 4, 5, 6, 7] + exclude=[6, 7] → "Weekdays"
 * [1, 2, 3, 4, 5, 6, 7] + exclude=[3] → "Daily except Tue"
 */
export function formatDays(days: number[], excludeDays: number[] = []): string {
  if (days.length === 0 && excludeDays.length === 0) return ''
  if (days.length === 0) return ''

  const sorted = [...days].sort((a, b) => a - b)
  const exclSet = new Set(excludeDays)

  if (sorted.length === 7 && excludeDays.length === 0) return 'Daily'
  if (sorted.length === 7 && excludeDays.length > 0) {
    if (excludeDays.sort((a, b) => a - b).join(',') === '6,7') return 'Weekdays'
    const exclNames = excludeDays.sort((a, b) => a - b).map(d => DAY_SHORT[d - 1])
    return `Daily except ${exclNames.join(', ')}`
  }
  if (sorted.length === 2 && sorted[1] - sorted[0] === 1 &&
      [1, 2, 3, 4, 5, 6].includes(sorted[0]) &&
      sorted[0] + 1 === sorted[1]) {
    return `${DAY_SHORT[sorted[0] - 1]}–${DAY_SHORT[sorted[1] - 1]}`
  }

  return sorted.map(d => DAY_SHORT[d - 1]).join(', ')
}

/**
 * Format one structured HH window into a human-readable string.
 * Returns null when the window is empty or unrecognized.
 */
export function formatWindow(
  type: string | null | undefined,
  daysStr: string | null | undefined,
  startMin: number | null | undefined,
  endMin: number | null | undefined,
  excludeDaysStr: string | null | undefined
): string | null {
  if (!type) return null

  const days = daysStr
    ? daysStr.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 7)
    : []
  const excludeDays = excludeDaysStr
    ? excludeDaysStr.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 7)
    : []
  const dayLabel = formatDays(days, excludeDays)

  if (type === 'all_day') return dayLabel ? `${dayLabel} all day` : 'All day'
  if (type === 'late_night') {
    // endMin=null means "to close"; startMin=null means no start specified
    if (startMin == null) {
      return dayLabel ? `${dayLabel} late night` : 'Late night'
    }
    const start = formatMin(startMin)
    // endMin=0 in DB = midnight; display it as "midnight" not "12:00 AM"
    const end = (endMin != null && endMin !== 0) ? formatMin(endMin) : 'midnight'
    return dayLabel ? `${dayLabel} ${start}–${end}` : `${start}–${end}`
  }
  if (type === 'typical') {
    if (startMin == null || endMin == null) return null
    const start = formatMin(startMin)
    // endMin=0 = midnight; display as "midnight" not "12:00 AM"
    const end = endMin !== 0 ? formatMin(endMin) : 'midnight'
    if (!dayLabel) return `${start}–${end}`
    // Handle midnight crossing
    if (endMin < startMin) return `${dayLabel} ${start}–${end}+`
    return `${dayLabel} ${start}–${end}`
  }
  return null
}

/**
 * Get a human-readable label for the venue's structured HH schedule.
 * Returns null if no structured HH data exists.
 */
export function getHhLabel(venue: Venue | LeanVenue): string | null {
  const parts: string[] = []
  const w1 = formatWindow(venue.hh_type, venue.hh_days, venue.hh_start, venue.hh_end, venue.hh_exclude_days)
  const w2 = formatWindow(venue.hh_type_2, venue.hh_days_2, venue.hh_start_2, venue.hh_end_2, venue.hh_exclude_days_2)
  const w3 = formatWindow(venue.hh_type_3, venue.hh_days_3, venue.hh_start_3, venue.hh_end_3, venue.hh_exclude_days_3)
  if (w1) parts.push(w1)
  if (w2) parts.push(w2)
  if (w3) parts.push(w3)

  // If we got no structured text, fall back to hh_summary (the raw user input text)
  if (parts.length === 0 && venue.hh_summary) {
    return venue.hh_summary
  }

  return parts.length > 0 ? parts.join(' · ') : null
}
