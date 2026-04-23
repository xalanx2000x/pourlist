/**
 * HH Schedule Parser
 *
 * Wraps `opening_hours.js` (OpenStreetMap standard) for time/day parsing,
 * then adds happy-hour-specific type classification on top.
 *
 * The four HH types:
 *   all_day     — "Monday all day", "Happy hour all day"
 *   open_through — "Open through 6pm", "Until 6pm", "Open to 6"
 *   typical     — "4-7pm", "Mon-Fri 3-6pm"
 *   late_night  — "10 to close", "10pm to close"
 */

import openingHoursLib from 'opening_hours'

export type HHType = 'all_day' | 'open_through' | 'typical' | 'late_night' | null

export interface HHWindow {
  type: HHType          // null = not a HH window
  days: number[]         // ISO weekday 1=Mon ... 7=Sun; empty = all days
  excludeDays: number[]  // ISO weekday(s) to EXCLUDE from this window
  startMin: number | null  // minutes since midnight; null = "open" / all_day uses venue open
  endMin: number | null   // minutes since midnight; null = "close" / all_day uses city close
}

export interface HHSchedule {
  windows: [HHWindow | null, HHWindow | null, HHWindow | null]  // [window1, window2, window3]
  rawText: string                                  // original text
}

/**
 * Convert "4pm" or "16:00" → minutes since midnight.
 * Returns null if unparseable.
 */
function parseTimeToMin(timeStr: string): number | null {
  const s = timeStr.trim().toLowerCase()

  // "midnight" → 0 minutes (12:00 AM)
  if (s === 'midnight') return 0

  // "4pm", "4 pm", "4p"
  // "4pm", "4 pm", "4p"
  const pmMatch = s.match(/^(\d{1,2})\s*(p|pm|p\.m\.?)?$/i)
  if (pmMatch) {
    let h = parseInt(pmMatch[1])
    if (h === 12) h = 12
    else if (h < 12) h += 12
    return h * 60
  }

  // "4am", "4 am", "4a"
  const amMatch = s.match(/^(\d{1,2})\s*(a|am|a\.m\.?)?$/i)
  if (amMatch) {
    let h = parseInt(amMatch[1])
    if (h === 12) h = 0
    return h * 60
  }

  // "16:00", "16"
  const colonMatch = s.match(/^(\d{1,2})(?::(\d{2}))?$/)
  if (colonMatch) {
    const h = parseInt(colonMatch[1])
    const m = colonMatch[2] ? parseInt(colonMatch[2]) : 0
    if (h < 0 || h > 24 || m < 0 || m > 59) return null
    if (h === 24) return 24 * 60  // midnight = 1440
    return h * 60 + m
  }

  return null
}

/**
 * Convert day abbreviation/name → ISO weekday (1=Mon ... 7=Sun).
 * Returns null if unrecognised.
 */
function parseDay(dayStr: string): number | null {
  const d = dayStr.toLowerCase().trim()
  const map: Record<string, number> = {
    monday: 1, mon: 1, m: 1,
    tuesday: 2, tue: 2, tu: 2, t: 2,
    wednesday: 3, wed: 3, w: 3,
    thursday: 4, thu: 4, th: 4,
    friday: 5, fri: 5, f: 5,
    saturday: 6, sat: 6, s: 6,
    sunday: 7, sun: 7, su: 7, u: 7,
  }
  return map[d] ?? null
}

/**
 * Parse a day range like "Mon-Fri" or "Monday to Friday"
 * into an array of ISO weekdays [1, 2, 3, 4, 5].
 */
function parseDayRange(rangeStr: string): number[] {
  const clean = rangeStr.replace(/\s+/g, '').toLowerCase()
  const days: number[] = []

  // Range: "Mon-Fri", "M-F", "mo-fr"
  const rangeMatch = clean.match(/^([a-z]+)-([a-z]+)$/)
  if (rangeMatch) {
    const start = parseDay(rangeMatch[1])
    const end = parseDay(rangeMatch[2])
    if (start != null && end != null) {
      let cur = start
      while (true) {
        days.push(cur)
        if (cur === end) break
        cur = cur === 7 ? 1 : cur + 1
      }
    }
    return days
  }

  // Single day: "Monday"
  const single = parseDay(clean)
  if (single !== null) return [single]

  // "weekdays" → Mon-Fri
  if (clean === 'weekdays') return [1, 2, 3, 4, 5]
  // "weekends" → Sat, Sun
  if (clean === 'weekends') return [6, 7]
  // "everyday" or "daily" → all days
  if (clean === 'everyday' || clean === 'daily') return [1, 2, 3, 4, 5, 6, 7]

  return []
}

/**
 * Classify a HH type from a text string using keyword detection.
 *
 * Returns { type, adjustedText } where adjustedText has type keywords removed.
 */
function classifyHHType(text: string): { type: HHType; adjustedText: string } {
  const lower = normalizeText(text)

  // ALL DAY: any mention of "all day" or "24/7" or "around the clock"
  if (/\b(all\s?day|24\s*[\/\\]?\s*7|24\s*hours?|around\s*the\s*clock)\b/.test(lower)) {
    const adjusted = lower.replace(/\b(all\s?day|24\s*[\/\\]?\s*7|24\s*hours?|around\s*the\s*clock)\b/gi, '').trim()
    return { type: 'all_day', adjustedText: adjusted }
  }

  // OPEN THROUGH: "open through", "open til", "open to", "until", "til", "thru", "before"
  if (/\b(open\s*(through|til|till|to|t'\s*t|thru)|until|til|till|thru|before)\b/.test(lower)) {
    const adjusted = lower
      .replace(/\b(open\s*(through|til|till|to|t'\s*t|thru))\b/gi, '')
      .replace(/\b(until|til|till|thru|before)\b/gi, '')
      .trim()
    return { type: 'open_through', adjustedText: adjusted }
  }

  // LATE NIGHT: "to close", "until close", "till close", "close"
  // Also catches bare X-close and X - close patterns (no "to/until" needed)
  // Also: "after [time]" → late_night (e.g. "after 9" = 9pm-close)
  // Also: "till midnight" → late_night (e.g. "10 till midnight" = 10pm-midnight)
  if (/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only|close|after\s+\d|till\s*midnight)\b/.test(lower)) {
    const adjusted = lower
      .replace(/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only|close)\b/gi, '')
      .replace(/\bafter\s+/i, '')  // strip "after " but keep the time number
      .trim()
    return { type: 'late_night', adjustedText: adjusted }
  }

  // TYPICAL: anything with a time window (e.g. "4-7pm", "3pm to 6pm")
  return { type: 'typical', adjustedText: lower }
}

/**
 * Normalize common typos and variants in HH text.
 * Runs before classifyHHType to maximize match rates.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    // Normalize dashes/hyphens to a consistent separator
    .replace(/\s*-\s*/g, '-')              // "4 - 6" → "4-6"
    .replace(/\s*–\s*/g, '-')              // en-dash
    .replace(/\s*—\s*/g, '-')              // em-dash
    // Normalize "to close" variants
    .replace(/\bto\s+(?:the\s+)?close\b/g, 'close')   // "to close" → "close"
    .replace(/\buntil\s+(?:the\s+)?close\b/g, 'close')
    .replace(/\btil\s+close\b/g, 'till close')
    .replace(/\bto\s+midnight\b/g, '-midnight')        // "to midnight" → time range "-midnight"
    .replace(/\buntil\s+midnight\b/g, '-midnight')
    .replace(/\btil\s+midnight\b/g, 'till midnight')   // "10 til midnight" → "10 till midnight" → late_night handled below
    // Normalize "from X" prefix (remove, keep the time)
    .replace(/\bfrom\s+/g, '')
    // Normalize "after X" (treat as late_night: X → close)
    // Normalize "starting at" → "from"
    .replace(/\bstarting\s+at\b/g, '')
    .replace(/\bstarts?\s+at\b/g, '')
    // Normalize "happy hour" mentions that don't add semantic meaning
    .replace(/\bhap*y\s*hour\b/gi, '')
    // Normalize "til" between letters → "till" (day ranges like "Mon til Fri")
    .replace(/(\D)til(\s|$)/g, '$1till$2')          // "Mon til Fri" → "Mon till Fri"
    .replace(/\bthru\b/g, 'through')                 // "thru" → "through"
    // Remove extra whitespace
    .replace(/\s+/g, ' ').trim()
}

/**
 * Parse a single clause (no commas) into one HHWindow.
 * Handles: "M-F 4-6", "W all day", "before 5", "10pm-close", etc.
 * Exported for use in HHScheduleInput (late night box).
 */
export function parseOneClause(text: string): HHWindow | null {
  const lower = text.trim()
  if (!lower) return null

  const { type, adjustedText } = classifyHHType(lower)

  // ── ALL DAY ──────────────────────────────────────────────────────────
  if (type === 'all_day') {
    // Try to extract a day that follows "all day" — e.g. "all day Monday" or "Monday all day"
    // Pattern: "all day [Day]" or "[Day] all day"
    let days: number[] = []

    // Try "all day Monday" form (keyword first)
    const afterMatch = lower.match(/\ball\s?day\b\s+([a-z]+)/i)
    if (afterMatch) {
      const d = parseDay(afterMatch[1])
      if (d !== null) days = [d]
    }

    // Try "Monday all day" form (day first)
    if (days.length === 0) {
      const beforeMatch = lower.match(/([a-z]+)\s+\ball\s?day\b/i)
      if (beforeMatch) {
        const d = parseDay(beforeMatch[1])
        if (d !== null) days = [d]
      }
    }

    return { type: 'all_day', days, excludeDays: [], startMin: null, endMin: null }
  }

  // ── NO EXPLICIT TIME for open_through / late_night ──────────────────
  if (!adjustedText && (type === 'open_through' || type === 'late_night')) {
    return { type, days: [], excludeDays: [], startMin: null, endMin: null }
  }

  // ── EXTRACT DAYS from the text ──────────────────────────────────────
  // e.g. "Mon-Fri 4-7pm" → day part = "Mon-Fri", time part = "4-7pm"
  const dayTimeMatch = adjustedText.match(/^([a-zA-Z\-,]+)\s+(.+)$/)
  let timePortion = adjustedText
  let days: number[] = []

  if (dayTimeMatch) {
    const dayPart = dayTimeMatch[1]
    timePortion = dayTimeMatch[2].trim()
    days = parseDayRange(dayPart)
  }

  // ── EXTRACT TIMES ───────────────────────────────────────────────────
  let startMin: number | null = null
  let endMin: number | null = null

  // Pattern: "4-7pm" (suffix on end), "4pm-7pm" (suffix on both), "4 to 7pm", "4-7" (bare)
  // The [-–—to ]+ with a space after "to" handles "4 to 7" explicitly
  const rangeMatch = timePortion.match(
    /^(\d{1,2})(?::(\d{2}))?\s*[-–—to ]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i
  )

  if (rangeMatch) {
    const rawStart = rangeMatch[1]           // "4"
    const rawStartMin = rangeMatch[2]        // optional minutes e.g. "30"
    const rawEnd = rangeMatch[3]             // "7"
    const rawEndMin = rangeMatch[4]          // optional minutes e.g. "30"
    const suffix = rangeMatch[5] ?? ''       // trailing suffix e.g. "pm"

    // Build full start/end strings with any explicit suffix
    const startStr = rawStartMin ? `${rawStart}:${rawStartMin}` : rawStart
    const endStr = rawEndMin ? `${rawEnd}:${rawEndMin}` : rawEnd

    // Determine what suffix to apply to each side:
    // "4pm-7pm"   → suffix on start (from "pm" after start)   → both get explicit pm
    // "4-7pm"     → suffix on end only                        → start gets pm (heuristic), end gets pm
    // "4 to 7"    → no suffix                                → start gets pm (heuristic), end gets am if < 12
    // "4-7"       → no suffix                                → start gets pm, end gets am if < 12

    const startSuffix = suffix || 'pm'   // bare range: assume first number = PM
    const endSuffix = suffix || ''       // bare range: no default on end (parseTimeToMin handles 12h)

    startMin = parseTimeToMin(startStr + startSuffix)
    endMin = parseTimeToMin(endStr + endSuffix)

    // If end is still null (parseTimeToMin failed), try AM for bare numbers < 12
    // e.g. "4-7" → endMin=7am (unlikely HH, but we can catch it in validation)
    if (endMin === null && !suffix && endStr) {
      endMin = parseTimeToMin(endStr + 'pm')
    }

    if (type === 'open_through') {
      // "open to 6pm": start is implicit (venue open = 2pm), end is explicit
      endMin = endMin ?? parseTimeToMin(endStr + (suffix || ''))
      startMin = startMin ?? (14 * 60)
    } else if (type === 'late_night') {
      // "10pm-close": end is implicit (bar close), start is explicit
      startMin = startMin ?? parseTimeToMin(startStr + (suffix || ''))
      endMin = null
    }
  }

  // ── FALLBACK: opening_hours.js for complex expressions ──────────────
  if (startMin === null && endMin === null && timePortion && /^\d/.test(timePortion)) {
    try {
      const oh = new openingHoursLib(timePortion)
      const intervals = oh.getOpenIntervals(new Date(), new Date(Date.now() + 24 * 3600 * 1000))
      if (intervals.length > 0) {
        startMin = intervals[0][0].getHours() * 60 + intervals[0][0].getMinutes()
        endMin = intervals[0][1].getHours() * 60 + intervals[0][1].getMinutes()
      }
    } catch {
      // leave null
    }
  }

  // ── "before X" in open_through: "before 5" → 2pm-5pm ──────────────
  // "before" was stripped from adjustedText by classifyHHType, so we check original `lower`
  if (type === 'open_through' && startMin === null && endMin === null) {
    // Look for a bare number at the start of adjustedText (the "X" in "before X")
    const bareMatch = adjustedText.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*(?:am|pm|a|p))?$/i)
    if (bareMatch) {
      const rawMin = parseTimeToMin(bareMatch[0])
      if (rawMin !== null) {
        // Bare number in "before X" → treat as PM (e.g. "before 5" = before 5pm)
        endMin = rawMin < 12 * 60 ? rawMin + 12 * 60 : rawMin
        // Start = 2pm (typical HH start)
        startMin = 14 * 60
      }
    }
  }

  // ── LATE NIGHT "X-close" / "after X": e.g. "10pm-close", "10-close", "after 9" ──
  if (type === 'late_night' && startMin === null && endMin === null) {
    // e.g. "10pm-close", "10-close", "10 p.m. to close", "4-close", "after 9", "after 10"
    const lnMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(?:am|pm|p\.?m\.?)?\s*[-–—to]*\s*close/i)
    if (lnMatch) {
      const hasExplicitPm = /pm|p\.?m\.?/i.test(lnMatch[0])
      const rawNum = parseInt(lnMatch[1])
      const assumePm = !hasExplicitPm && !/am/i.test(lnMatch[0]) && rawNum >= 4
      const suffix = hasExplicitPm ? 'pm' : (assumePm ? 'pm' : '')
      startMin = parseTimeToMin(lnMatch[1] + (lnMatch[2] ? ':' + lnMatch[2] : '') + suffix)
      endMin = null
    } else {
      // "after X" — no "close" word, treat as late_night from X to close
      // Try to match a bare number at the end: "after 9", "after 10"
      const afterMatch = lower.match(/\bafter\s+(\d{1,2})(?::(\d{2}))?(?:\s*(?:am|pm|p\.?m\.?))?/i)
      if (afterMatch) {
        const hasExplicitPm = /pm|p\.?m\.?/i.test(afterMatch[0])
        const rawNum = parseInt(afterMatch[1])
        const assumePm = !hasExplicitPm && !/am/i.test(afterMatch[0]) && rawNum >= 4
        const suffix = hasExplicitPm ? 'pm' : (assumePm ? 'pm' : '')
        startMin = parseTimeToMin(afterMatch[1] + (afterMatch[2] ? ':' + afterMatch[2] : '') + suffix)
        endMin = null
      }
    }
  }

  // Nothing usable found
  if (startMin === null && endMin === null && type === 'typical') return null

  return {
    type: type ?? 'typical',
    days: days.length > 0 ? days : [],
    excludeDays: [],
    startMin,
    endMin
  }
}

/**
 * Split a day array into non-overlapping pieces by removing overlapDays.
 * e.g. splitPieces([1,2,3,4,5], [3,5]) → [[1,2], [4]]
 * e.g. splitPieces([1,2,3,4,5], [3]) → [[1,2], [4,5]]
 */
function splitIntoPieces(allDays: number[], removeDays: number[]): number[][] {
  const removeSet = new Set(removeDays)
  const pieces: number[][] = []
  let current: number[] = []

  for (const day of allDays) {
    if (removeSet.has(day)) {
      if (current.length > 0) {
        pieces.push(current)
        current = []
      }
    } else {
      current.push(day)
    }
  }
  if (current.length > 0) pieces.push(current)
  return pieces
}

/**
 * Add a window to the stored list, splitting any existing window that overlaps
 * with the new window's days. Single data points take priority over ranges.
 *
 * @param stored - current list of windows (mutated)
 * @param newWindow - new window to add
 */
function addWindowWithOverlap(stored: HHWindow[], newWindow: HHWindow): void {
  const newDaysSet = new Set(newWindow.days)
  let insertAt = stored.length // where to insert new window

  for (let i = stored.length - 1; i >= 0; i--) {
    const existing = stored[i]
    if (existing.days.length === 0) continue // "all days" — can't split meaningfully

    const overlap = existing.days.filter(d => newDaysSet.has(d))
    if (overlap.length === 0) continue

    // Split existing into non-overlapping pieces
    const pieces = splitIntoPieces(existing.days, newWindow.days)

    // Remove the old entry
    stored.splice(i, 1)

    // Insert the non-overlap pieces back at the same position
    for (let p = pieces.length - 1; p >= 0; p--) {
      stored.splice(i, 0, { ...existing, days: pieces[p] })
    }

    // Adjust insertAt since we added pieces.length - 1 new entries before it
    insertAt = i
  }

  // Insert the new window at the correct position (before any windows that come after it)
  stored.splice(insertAt, 0, newWindow)
}

/**
 * Parse a menu text string into an HHSchedule.
 *
 * Handles comma-separated clauses with overlap detection:
 * - Comma splits into separate clauses (each = one potential window)
 * - "and"/"&"/"also" within a clause splits into sub-clauses
 * - Single data points (e.g. "Wednesday") take priority over ranges (e.g. "M-F")
 * - Overlapping days cause the range to be split into non-overlapping parts
 *
 * @param text - raw menu text
 * @returns HHSchedule with up to 3 windows
 */
export function parseHHSchedule(text: string): HHSchedule {
  if (!text || !text.trim()) {
    return { windows: [null, null, null], rawText: text }
  }

  // Step 1: Split on commas
  const commaClauses = text.split(',').map(c => c.trim()).filter(c => c.length > 0)

  const stored: HHWindow[] = []

  for (const clause of commaClauses) {
    // Step 2: Within each clause, split on "and"/"&"/"also"
    const lower = clause.toLowerCase()
    const splitMatch = lower.match(/^(.+?)\s*(?:,?\s*(?:and|&|also)\s*)+(.+)$/)

    const subClauses: string[] = []
    if (splitMatch) {
      // Extract the original-case text for the two parts
      const orig1 = clause.slice(0, splitMatch[1].length).trim()
      const orig2 = clause.slice(clause.length - splitMatch[2].length).trim()
      if (orig1) subClauses.push(orig1)
      if (orig2) subClauses.push(orig2)
    } else {
      subClauses.push(clause)
    }

    // Step 3: Parse each sub-clause and add with overlap detection
    for (const sub of subClauses) {
      const window = parseOneClause(sub)
      if (!window || !window.type) continue

      // If window has no days (e.g. just "4-6pm" without a day), default to all days
      if (window.days.length === 0) {
        window.days = [1, 2, 3, 4, 5, 6, 7]
      }

      addWindowWithOverlap(stored, window)
    }
  }

  // Step 4: Cap at 3 windows
  const windows: [HHWindow | null, HHWindow | null, HHWindow | null] = [null, null, null]
  for (let i = 0; i < Math.min(stored.length, 3); i++) {
    windows[i] = stored[i]
  }

  return { windows, rawText: text }
}

/**
 * Convert HH minutes (since midnight) to a human-readable string.
 * e.g. 960 → "4:00 PM", 1140 → "7:00 PM"
 */
export function formatHHTime(minutes: number | null): string {
  if (minutes === null) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const period = h < 12 ? 'AM' : 'PM'
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`
}

/**
 * Day number → short day name.
 */
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function formatHHDays(days: number[]): string {
  if (days.length === 0) return 'Any day'
  if (days.length === 7) return 'Every day'
  if (days.length === 5 && days.join(',') === '1,2,3,4,5') return 'Weekdays'
  if (days.length === 2 && days.join(',') === '6,7') return 'Weekends'
  return days.map(d => DAY_NAMES[d - 1]).join(', ')
}

/**
 * Validate an HHWindow: make sure start/end times make sense.
 * Returns an error message or null if valid.
 */
export function validateHHWindow(window: HHWindow | null): string | null {
  if (!window) return null
  if (!window.type) return null

  if (window.type === 'all_day') return null

  if (window.startMin === null && window.endMin === null) {
    return 'Please set a start time, end time, or both.'
  }

  if (window.startMin !== null && window.endMin !== null) {
    const crossesMidnight = window.startMin > window.endMin
    if (!crossesMidnight && window.startMin >= window.endMin) {
      return 'Start time must be before end time.'
    }
  }

  return null
}