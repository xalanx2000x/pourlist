/**
 * HH timing — SOLE AUTHORITY.
 *
 * resolveHH is the single function that turns a venue's stored HH pattern
 * into real Date moments. All time reasoning lives here and nowhere else.
 *
 * Design:
 *   - Uses venue.timezone for all clock math (currentMinutesInTz, isoWeekdayInTz, buildDateAtMin).
 *   - Uses venue.city + venue.state for bar-close-time lookup — never the timezone string.
 *   - Returns REAL Date objects — "how far away" is just subtraction.
 *   - Injectable `now` so callers and tests can freeze the clock.
 *   - Handles midnight-crossing, multiple windows, til-close, all_day, late_night.
 *
 * Thin readers:
 *   - getHHState     → HHState color string  (for map pins, card borders)
 *   - hasActiveHappyHour → boolean            (for badges, filters)
 *
 * Bar-close defaults (from bar-close-times.ts):
 *   Uses getCityCloseMin(venue.city ?? '', venue.state ?? '').
 *   Falls back to 2am (120) when city/state unavailable or lookup misses.
 */

import type { Venue } from '@/lib/supabase'
import { getCityCloseMin } from '@/lib/bar-close-times'

// ─── Types ───────────────────────────────────────────────────────────────────

export type HHState = 'default' | 'hh_today' | 'hh_soon' | 'active'

const HH_COLORS: Record<HHState, string> = {
  default:  '#f97316',  // orange
  hh_today: '#f97316',  // orange (outer ring)
  hh_soon:  '#f97316',  // orange — only active is purple; soon/today use text cues
  active:   '#a855f7',  // purple
}
export { HH_COLORS as HH_COLORS }

/** resolveHH is the canonical result type — all time truth lives here. */
export type HHResolution = {
  isLive:    boolean
  /** When isLive: real close moment of the current active window. null = til-close. */
  closesAt:  Date | null
  /** When NOT isLive: real open moment of the soonest upcoming window. */
  opensAt:   Date | null
  /** Resolved end-minutes for the active/soon window; null = til-close. */
  endsAtMin: number | null
}

type RawWindow = {
  startMin:   number | null | undefined
  endMin:     number | null | undefined
  days:       string | null | undefined
  type:       string | null | undefined
  openingMin: number | null
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Current minutes-past-midnight in the given IANA timezone. */
function currentMinutesInTz(tz: string | null, now: Date): number {
  if (!tz) return now.getHours() * 60 + now.getMinutes()
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const h = parseInt(parts.find(p => p.type === 'hour')?.value   ?? '0')
  const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0')
  return h * 60 + m
}

/** ISO weekday (1=Mon..7=Sun) in the given timezone. */
function isoWeekdayInTz(tz: string | null, now: Date): number {
  if (!tz) {
    const dow = now.getDay()
    return dow === 0 ? 7 : dow
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'short',
  }).formatToParts(now)
  const dayStr = parts.find(p => p.type === 'weekday')?.value ?? ''
  const map: Record<string, number> = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return map[dayStr] ?? 1
}

/**
 * Build a JS Date representing "today at startMin minutes-past-midnight in tz".
 *
 * Uses Intl + localeString to measure and correct the UTC offset — no manual
 * add/subtract of offset hours. Works correctly across DST boundaries.
 */
function buildDateAtMin(tz: string | null, now: Date, startMin: number): Date {
  if (!tz) {
    const d = new Date(now)
    d.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0)
    return d
  }
  const dParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const y = +dParts.find(p => p.type === 'year')!.value
  const m = +dParts.find(p => p.type === 'month')!.value
  const d = +dParts.find(p => p.type === 'day')!.value
  const hh = Math.floor(startMin / 60), mm = startMin % 60

  // UTC guess for that wall-clock time on that calendar day
  let ts = Date.UTC(y, m - 1, d, hh, mm)

  // Measure how far off that guess is and correct
  const asTz  = new Date(new Date(ts).toLocaleString('en-US', { timeZone: tz }))
  const asUtc = new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'UTC' }))
  const offsetMin = Math.round((asUtc.getTime() - asTz.getTime()) / 60_000)
  ts += offsetMin * 60_000

  return new Date(ts)
}

/** Parse comma-separated ISO weekday string. "1,2,3" → [1,2,3] */
function parseDays(daysStr: string | null | undefined): number[] {
  if (!daysStr || !daysStr.trim()) return []
  return daysStr.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 7)
}

/** Resolve a window's end-minutes using the venue's real city+state (NOT timezone). */
function resolveEndMin(w: RawWindow, venue: Partial<Venue>): number | null {
  if (w.endMin !== null && w.endMin !== undefined) return w.endMin
  if (w.type === 'late_night' || w.type === 'all_day') {
    return getCityCloseMin(venue.city ?? '', venue.state ?? '')
  }
  return null
}

/** True when currentMin is inside this HH window. */
function isInWindow(w: RawWindow, currentMin: number, venue: Partial<Venue>): boolean {
  const effectiveStart = (w.type === 'all_day') ? (w.openingMin ?? 14 * 60) : w.startMin
  if (effectiveStart === null || effectiveStart === undefined) return false
  const end = resolveEndMin(w, venue)
  if (end === null) return false
  if (effectiveStart > end) {
    // Midnight crossing: e.g. 22:00–02:00
    return currentMin >= effectiveStart || currentMin < end
  }
  return currentMin >= effectiveStart && currentMin < end
}

/** True when currentMin is within 60 min before the window starts. */
function isSoonWindow(w: RawWindow, currentMin: number): boolean {
  if (w.startMin === null || w.startMin === undefined) return false
  return (w.startMin - 60) <= currentMin && currentMin < w.startMin
}

// ─── resolveHH — SOLE AUTHORITY ─────────────────────────────────────────────

/**
 * Turn a venue's HH pattern into real Date moments.
 *
 * venue.timezone  → clock math only (currentMinutesInTz, isoWeekdayInTz, buildDateAtMin)
 * venue.city/state → bar-close lookup (getCityCloseMin)
 *
 * @param venue  Venue with hh_* fields + timezone + city + state
 * @param now    Injectable wall-clock; defaults to Date.now()
 */
export function resolveHH(venue: Partial<Venue>, now: Date = new Date()): HHResolution {
  const tz         = venue.timezone ?? null
  const currentMin = currentMinutesInTz(tz, now)
  const todayISO   = isoWeekdayInTz(tz, now)
  const openingMin = venue.opening_min as number | null ?? null

  const windows: RawWindow[] = [
    { startMin: venue.hh_start,    endMin: venue.hh_end,    days: venue.hh_days,    type: venue.hh_type,    openingMin },
    { startMin: venue.hh_start_2,  endMin: venue.hh_end_2,  days: venue.hh_days_2,  type: venue.hh_type_2,  openingMin },
    { startMin: venue.hh_start_3,  endMin: venue.hh_end_3,  days: venue.hh_days_3,  type: venue.hh_type_3,  openingMin },
  ]

  // ── Active window ───────────────────────────────────────────────────────────
  for (const w of windows) {
    if (!isTodayWindow(w, todayISO)) continue
    if (isInWindow(w, currentMin, venue)) {
      const endsAtMin = resolveEndMin(w, venue)
      let closesAt: Date | null = null
      if (endsAtMin !== null) {
        const endDate = buildDateAtMin(tz, now, endsAtMin)
        // Midnight-crossing: endDate may already be tomorrow local-time.
        // If endDate <= now, the window has already closed (at or past end moment).
        closesAt = endDate <= now ? null : endDate
      }
      const effectiveStart = (w.type === 'all_day') ? (w.openingMin ?? 14 * 60) : w.startMin
      const opensAt = (effectiveStart != null)
        ? buildDateAtMin(tz, now, effectiveStart)
        : null
      return { isLive: true, closesAt, opensAt, endsAtMin }
    }
  }

  // ── No active window — find the soonest upcoming occurrence ─────────────────
  let soonestOpen:     Date | null = null
  let soonestEnd:      number | null = null
  let soonestStartMin: number | null = null

  // Today: windows that haven't started yet
  for (const w of windows) {
    if (!isTodayWindow(w, todayISO)) continue
    const effectiveStart = (w.type === 'all_day') ? (w.openingMin ?? 14 * 60) : w.startMin
    if (effectiveStart === null || effectiveStart === undefined) continue
    if (currentMin < effectiveStart) {
      const open = buildDateAtMin(tz, now, effectiveStart)
      if (soonestOpen === null || open < soonestOpen) {
        soonestOpen     = open
        soonestEnd      = resolveEndMin(w, venue)
        soonestStartMin = effectiveStart
      }
    }
  }

  // Forward across future days
  for (let offset = 1; offset <= 7; offset++) {
    const future    = new Date(now)
    future.setDate(future.getDate() + offset)
    const futureISO = isoWeekdayInTz(tz, future)
    for (const w of windows) {
      if (!isTodayWindow(w, futureISO)) continue
      const effectiveStart = (w.type === 'all_day') ? (w.openingMin ?? 14 * 60) : w.startMin
      if (effectiveStart === null || effectiveStart === undefined) continue
      // Total minutes from now to window start on future date
      const minsToMidnight = 24 * 60 - currentMin
      const minsToWindow   = minsToMidnight + (offset - 1) * 24 * 60 + effectiveStart
      const open = new Date(now.getTime() + minsToWindow * 60 * 1000)
      if (soonestOpen === null || open < soonestOpen) {
        soonestOpen     = open
        soonestEnd      = resolveEndMin(w, future instanceof Date ? venue : venue)
        soonestStartMin = effectiveStart
      }
    }
    if (soonestOpen !== null) break
  }

  return { isLive: false, closesAt: null, opensAt: soonestOpen, endsAtMin: soonestEnd }
}

/** True when the window is scheduled for the given ISO weekday. */
function isTodayWindow(w: RawWindow, todayISO: number): boolean {
  const days = parseDays(w.days)
  if (days.length === 0) return true
  return days.includes(todayISO)
}

// ─── Thin readers ─────────────────────────────────────────────────────────────

/**
 * Returns the highest-priority HH state for a venue (map pins + card borders).
 * Thin reader of resolveHH.
 */
export function getHHState(venue: Partial<Venue>, now?: Date): HHState {
  const res  = resolveHH(venue, now)
  if (res.isLive) return 'active'
  if (!res.opensAt) return 'default'

  const base      = now ?? new Date()
  const opensInMin = Math.round((res.opensAt.getTime() - base.getTime()) / 60_000)

  // hh_today means "a window later today, within a reasonable horizon."
  // 1am check for a 4pm window = 15h away = same calendar day but not "today" by intent.
  const isSameDay = opensAtIsSameDay(res.opensAt, base, venue.timezone ?? null)
  const withinToday = isSameDay && opensInMin < 24 * 60

  if (opensInMin <= 60) return 'hh_soon'
  if (opensInMin <= 6 * 60 && withinToday) return 'hh_today' // within 6 hours

  return 'default'
}

/** True when dt and now fall on the same calendar day in venue.timezone. */
function opensAtIsSameDay(dt: Date, now: Date, tz: string | null): boolean {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz ?? undefined,
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  return fmt.format(dt) === fmt.format(now)
}

/**
 * Returns true when the venue's HH is currently active.
 * Thin reader of resolveHH.
 */
export function hasActiveHappyHour(venue: Partial<Venue>, now?: Date): boolean {
  return resolveHH(venue, now).isLive
}

// ─── formatMin — kept for format-schedule.ts ─────────────────────────────────

export function getHHColor(state: HHState): string {
  return HH_COLORS[state]
}

export function formatMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const period = h < 12 ? 'AM' : 'PM'
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`
}
