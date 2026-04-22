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
  days: number[]        // ISO weekday 1=Mon ... 7=Sun; empty = no day restriction
  startMin: number | null  // minutes since midnight; null = "open"
  endMin: number | null   // minutes since midnight; null = "close"
}

export interface HHSchedule {
  windows: [HHWindow | null, HHWindow | null]  // [window1, window2]
  rawText: string                                  // original text
}

/**
 * Convert "4pm" or "16:00" → minutes since midnight.
 * Returns null if unparseable.
 */
function parseTimeToMin(timeStr: string): number | null {
  const s = timeStr.trim().toLowerCase()

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
 * This is the "human-in-the-loop" preprocessor that identifies the semantic type
 * before opening_hours.js parses the time portion.
 *
 * Returns { type, adjustedText } where adjustedText has type keywords removed.
 */
function classifyHHType(text: string): { type: HHType; adjustedText: string } {
  const lower = text.toLowerCase()

  // ALL DAY: any mention of "all day" or "24/7" or "around the clock"
  if (/\b(all\s?day|24\s*[\/\\]?\s*7|24\s*hours?|around\s*the\s*clock)\b/.test(lower)) {
    // Strip the keyword, keep remaining text for time parsing
    const adjusted = lower.replace(/\b(all\s?day|24\s*[\/\\]?\s*7|24\s*hours?|around\s*the\s*clock)\b/gi, '').trim()
    return { type: 'all_day', adjustedText: adjusted }
  }

  // OPEN THROUGH: "open through", "open til", "open to", "until Xpm", "til Xpm", "thru Xpm"
  if (/\b(open\s*(through|til|till|to|t'\s*t|thru)|until|til|till|thru)\b/.test(lower)) {
    const adjusted = lower
      .replace(/\b(open\s*(through|til|till|to|t'\s*t|thru))\b/gi, '')
      .replace(/\b(until|til|till|thru)\b/gi, '')
      .trim()
    return { type: 'open_through', adjustedText: adjusted }
  }

  // LATE NIGHT: "to close", "until close", "till close", "close"
  if (/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only)\b/.test(lower)) {
    const adjusted = lower.replace(/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only)\b/gi, '').trim()
    return { type: 'late_night', adjustedText: adjusted }
  }

  // TYPICAL: anything with a time window (e.g. "4-7pm", "3pm to 6pm")
  // opening_hours.js will parse this
  return { type: 'typical', adjustedText: lower }
}

/**
 * Parse a single time window text (like "4-7pm" or "Mon-Fri 3-6pm")
 * into an HHWindow. Used both for primary and secondary windows.
 */
function parseOneWindow(text: string): HHWindow | null {
  const lower = text.trim()
  if (!lower) return null

  // Classify type first
  const { type, adjustedText } = classifyHHType(lower)

  if (type === 'all_day') {
    return { type: 'all_day', days: [], startMin: null, endMin: null }
  }

  if (!adjustedText && (type === 'open_through' || type === 'late_night')) {
    // Keyword present but no explicit time — treat as "open" or "close" only
    return { type, days: [], startMin: null, endMin: null }
  }

  // Extract days from the text (before the time portion)
  // e.g. "Mon-Fri 4-7pm" → day range = "Mon-Fri", time = "4-7pm"
  const dayTimeMatch = adjustedText.match(/^([a-zA-Z\-,]+)\s+(.+)$/)
  let timePortion = adjustedText
  let days: number[] = []

  if (dayTimeMatch) {
    const dayPart = dayTimeMatch[1]
    timePortion = dayTimeMatch[2].trim()
    days = parseDayRange(dayPart)
  }

  // Try to parse the time portion with opening_hours.js
  let startMin: number | null = null
  let endMin: number | null = null

  // Build an OSM-compatible time string for opening_hours.js
  // e.g. "4-7pm" → "16:00-19:00"
  const osmTimeMatch = timePortion.match(
    /(\d{1,2})(?::(\d{2}))?\s*[-–—to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i
  )

  if (osmTimeMatch) {
    const startStr = osmTimeMatch[1]
    const startMinPart = osmTimeMatch[2]
    const endStr = osmTimeMatch[3]
    const endMinPart = osmTimeMatch[4]
    const suffix = osmTimeMatch[5]

    startMin = parseTimeToMin(startStr + (startMinPart ? ':' + startMinPart : '') + (suffix ? suffix[0] : ''))
    endMin = parseTimeToMin(endStr + (endMinPart ? ':' + endMinPart : '') + (suffix ? suffix[0] : ''))

    // For open_through: "open to 6pm" means from 2pm until end
    // For late_night: "until close" means start until close (endMin = null)
    if (type === 'open_through') {
      endMin = endMin ?? parseTimeToMin(endStr + (suffix ? suffix[0] : ''))
      startMin = startMin ?? 14 * 60  // "open" = 2pm default
    } else if (type === 'late_night') {
      startMin = startMin ?? parseTimeToMin(startStr + (suffix ? suffix[0] : ''))
      endMin = null  // "until close" — we don't know closing time
    }
  } else if (timePortion && /^\d/.test(timePortion)) {
    // Try opening_hours.js as fallback for complex time expressions
    try {
      const oh = new openingHoursLib(timePortion)
      const intervals = oh.getOpenIntervals(new Date(), new Date(Date.now() + 24 * 3600 * 1000))
      if (intervals.length > 0) {
        const start = intervals[0][0]
        const end = intervals[0][1]
        startMin = start.getHours() * 60 + start.getMinutes()
        endMin = end.getHours() * 60 + end.getMinutes()
      }
    } catch {
      // opening_hours.js couldn't parse it — leave null
    }
  }

  // If we got nothing, return null
  if (startMin === null && endMin === null && type === 'typical') return null

  return {
    type: type ?? 'typical',
    days: days.length > 0 ? days : [],
    startMin,
    endMin
  }
}

/**
 * Parse a menu text string into an HHSchedule.
 *
 * Handles up to two HH windows separated by common conjunctions.
 * Falls back gracefully if the text can't be parsed.
 *
 * @param text - raw menu text (e.g. from AI extraction or user input)
 * @returns HHSchedule with windows and original text
 */
export function parseHHSchedule(text: string): HHSchedule {
  if (!text || !text.trim()) {
    return { windows: [null, null], rawText: text }
  }

  const lower = text.toLowerCase()

  // Split on " and " or " & " or " also " to detect two windows
  // But be careful not to split on "Mon-Fri and Sat" (that's a day range)
  // Strategy: look for patterns like " - " or " to " between numbers that suggest time windows
  const windowTexts: string[] = []

  // Split on patterns that clearly separate two HH windows
  // "4-7pm and 10pm-midnight" or "4pm-7pm & 10pm-12am"
  const splitMatch = lower.match(/^(.+?)\s*(?:,?\s*(?:and|&|also)\s*)+(.+)$/)
  if (splitMatch) {
    const w1 = splitMatch[1].trim()
    const w2 = splitMatch[2].trim()
    if (w1) windowTexts.push(w1)
    if (w2) windowTexts.push(w2)
  } else {
    windowTexts.push(lower)
  }

  const windows: [HHWindow | null, HHWindow | null] = [null, null]

  for (let i = 0; i < Math.min(windowTexts.length, 2); i++) {
    windows[i] = parseOneWindow(windowTexts[i])
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
  if (!window) return null  // null is fine (no HH)
  if (!window.type) return null

  // For all_day, no time needed
  if (window.type === 'all_day') return null

  // At least one of start/end should be set
  if (window.startMin === null && window.endMin === null) {
    return 'Please set a start time, end time, or both.'
  }

  // If both set, start should be before end (with some tolerance for late-night)
  if (window.startMin !== null && window.endMin !== null) {
    // Allow crossing midnight (e.g. 10pm-2am = 1320 to 120)
    const crossesMidnight = window.startMin > window.endMin
    if (!crossesMidnight && window.startMin >= window.endMin) {
      return 'Start time must be before end time.'
    }
  }

  return null
}
