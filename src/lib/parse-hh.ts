/**
 * HH Schedule Parser
 *
 * Wraps `opening_hours.js` (OpenStreetMap standard) for time/day parsing,
 * then adds happy-hour-specific type classification on top.
 *
 * The three HH types:
 *   all_day     — "Monday all day", "Happy hour all day"
 *   typical     — "4-7pm", "Mon-Fri 3-6pm", "open 2-6pm"
 *   late_night  — "10 to close", "10pm to close"
 */

import openingHoursLib from 'opening_hours'

export type HHType = 'all_day' | 'typical' | 'late_night' | null

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
  totalParsed: number  // count of windows parsed before the 3-window cap
}

/**
 * Convert "4pm" or "16:00" → minutes since midnight.
 * Returns null if unparseable.
 */
function parseTimeToMin(timeStr: string): number | null {
  const s = timeStr.trim().toLowerCase()

  // "midnight" → 0 (DB stores as endMin=0; formatWindow displays as "midnight")
  if (s === 'midnight') return 0

  // "noon" → 720 (12:00 PM)
  if (s === 'noon') return 720

  // "open" → null (venue open time; treated as startMin=null)
  if (s === 'open') return null

  // "close" → null (venue close time; treated as endMin=null)
  if (s === 'close') return null

  // "3:30pm", "4:30am" — colon with optional am/pm suffix
  const colonPmMatch = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm|p\.m\.?)?$/i)
  if (colonPmMatch) {
    let h = parseInt(colonPmMatch[1])
    const m = parseInt(colonPmMatch[2])
    const suffix = (colonPmMatch[3] || '').toLowerCase()
    if (suffix === 'am') { if (h === 12) h = 0 }
    else if (h < 12) h += 12  // pm suffix: add 12h (but 12pm stays 12)
    return h * 60 + m
  }

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

  // LATE NIGHT: "to close", "until close", "till close", "close"
  // Also catches bare X-close and X - close patterns (no "to/until" needed)
  // Also: "after [number]" → late_night (e.g. "after 9" = 9pm-close)
  // Also: "to midnight" / "till midnight" / "after midnight" → midnight to close
  if (/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only|close|to\s*midnight|till\s*midnight|after\s+\d+(?::\d{2})?\s*(?:am|pm|p\.?m\.?)?|after\s+midnight)\b/.test(lower)) {
    const adjusted = lower
      .replace(/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only|close)\b/gi, '')
      .replace(/\bto\s*midnight\b/gi, '')    // strip "to midnight" but keep nothing (it's end-of-day)
      .replace(/\btill\s*midnight\b/gi, '')  // strip "till midnight" but keep nothing
      .replace(/\bafter\s+\d+\b/gi, '')      // strip "after 12" etc, keep nothing (time already handled)
      .replace(/\bafter\s+midnight\b/gi, '')  // strip "after midnight" but keep nothing
      .replace(/-midnight/, 'midnight')        // clean up residual from normalizeText
      .trim()
    return { type: 'late_night', adjustedText: adjusted }
  }

  // MIDNIGHT TO CLOSE: "midnight to close" / "midnight-close" → start=midnight, end=close (late_night)
  if (/\bmidnight\s+to\s+close\b/.test(lower) || /\bmidnight\s*-\s*close\b/.test(lower)) {
    return { type: 'late_night', adjustedText: 'midnight' }  // startMin=0, endMin=null
  }

  // MIDNIGHT AS STANDALONE: bare "midnight" → midnight to close (late_night)
  // Already normalized to just "midnight" by normalizeText's midnight-close collapse
  if (lower === 'midnight') {
    return { type: 'late_night', adjustedText: 'midnight' }  // startMin=0, endMin=null
  }

  // MIDNIGHT TO TIME: "midnight-2am", "midnight-6am" → late_night start at midnight, end at given time
  if (/\bmidnight\s*-\s*(\d)/.test(lower)) {
    return { type: 'late_night', adjustedText: lower }  // e.g. "midnight-2am" → parse in late_night block
  }

  // TYPICAL: anything with a time window (e.g. "4-7pm", "3pm to 6pm", "10-2")
  // Note: "open-6pm"/"open-6" is normalized to "2pm-6pm"/"2pm-6" by normalizeText
  // before this function runs, so no special "open" handling needed here.
  return { type: 'typical', adjustedText: lower }
}

/**
 * Progressive day-prefix resolver.
 * Given a token (already lowercased, trimmed), returns the ISO weekday if it matches
 * a day-name prefix, applying tie-breaking rules:
 *   t  → Tuesday (default), th/thu/thur/thurs → Thursday
 *   s  → Saturday (default), su/sun            → Sunday
 *   m  → Monday,  w → Wednesday,  f → Friday
 *
 * Standalone use for single-day parsing; also called from parseDayRange.
 */
const DAY_PREFIXES: Record<string, number> = {
  'm':1,'mo':1,'mon':1,'mond':1,'monda':1,'monday':1,
  'tu':2,'tue':2,'tues':2,'tuesd':2,'tuesda':2,'tuesday':2,
  'w':3,'we':3,'wed':3,'wedn':3,'wedne':3,'wednes':3,'wednesd':3,'wednesda':3,'wednesday':3,
  'th':4,'thu':4,'thur':4,'thurs':4,'thursd':4,'thursda':4,'thursday':4,
  'f':5,'fr':5,'fri':5,'frid':5,'frida':5,'friday':5,
  'sa':6,'sat':6,'satur':6,'saturd':6,'saturda':6,'saturday':6,
  'su':7,'sun':7,'sund':7,'sunda':7,'sunday':7,
}
function resolveDayPrefix(token: string): number | null {
  return DAY_PREFIXES[token.toLowerCase().trim()] ?? null
}

/**
 * Convert day abbreviation/name (including progressive prefixes) → ISO weekday (1=Mon ... 7=Sun).
 */
function parseDay(dayStr: string): number | null {
  return resolveDayPrefix(dayStr.toLowerCase().trim())
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
 * Normalize common typos and variants in HH text.
 * Runs before classifyHHType to maximize match rates.
 *
 * ORDER MATTERS — most-specific rules first, least-specific last.
 * All rules are anchored (word boundaries, correct position) to avoid clobbering
 * unrelated tokens.
 */
function normalizeText(text: string): string {
  const lower = text.toLowerCase()

  return lower
    // ── MOST SPECIFIC: time tokens that contain letters (before any am/pm handling) ──

    // "midnight" / "12am" / "12:00am" / "12:00 am" → "midnight" (one canonical token)
    // Anchored: must be standalone or hyphenated-time, not inside another word.
    // "12:00 am" and "12:00am" both normalized before any bare-digit handling.
    .replace(/\b12\s*:\s*00\s*am\b/g, 'midnight')
    .replace(/\b12\s*am\b/g, 'midnight')

    // "noon" / "12pm" / "12:00pm" / "12:00 pm" → "noon" (one canonical token)
    .replace(/\b12\s*:\s*00\s*pm\b/g, 'noon')
    .replace(/\b12\s*pm\b/g, 'noon')

    // "open" → "open" (keep as time anchor; will be handled in time parsing as start=2pm)
    // Already lowercase, no change needed.

    // ── SEPARATORS: normalize ALL range connectors to single hyphen ──
    // Anchored: these appear between two tokens, not inside time/date tokens.
    // "10 to 6", "10 til 6", "10 until 6", "10 through 6" → "10-6"
    // Time til time: "4 til 7" → "4-7"
    .replace(/(\d)\s+(?:to|til|till|until)\s+(\d)/g, '$1-$2')
    // Day til day: "mon til wed" → "mon-wed"
    .replace(/([a-z])\s+(?:til|till|until|to)\s+([a-z])/gi, '$1-$2')
    // Generic en/em dashes → hyphen
    .replace(/\s*[–—]\s*/g, '-')
    // "thru" → "-" (through as separator, not "open through" keyword — handled separately)
    // "4 thru 6" → "4-6"
    .replace(/(\d)\s+thru\s+(\d)/gi, '$1-$2')
    // "through" standalone: keep it as "through" for now; classifyHHType uses it as keyword
    .replace(/\bthru\b/gi, 'through')

    // "til" as standalone connector (after time-range already normalized):
    // "Mon til Fri" already handled above by day til day rule.
    // "til close" preserved below.

    // ── MIDNIGHT / NOON in hyphenated time ranges ──
    // After separator normalization: "10pm-midnight" / "10pm - midnight" / "10pm to midnight"
    // → "10pm-midnight" then "midnight" preserved as end anchor.
    // "midnight-close" → "midnight" (collapse, then close stripped in next block)
    .replace(/midnight\s*-\s*close/gi, 'midnight')
    .replace(/midnight-close/gi, 'midnight')

    // "to close" / "until close" → "close" (after time-range normalization)
    // Negative lookbehind: don't fire after a letter (would clobber "X to close")
    .replace(/(?<![a-z])to\s+(?:the\s+)?close\b/g, 'close')
    .replace(/(?<![a-z])until\s+(?:the\s+)?close\b/g, 'close')

    // "til close" → "till close" (canonical form for classifier)
    .replace(/\btil\s+close\b/g, 'till close')

    // "to midnight" → "-midnight" (preserve start time; classifier reads "time-midnight")
    // Anchored: must not fire after am/pm.
    .replace(/(?<![a-zA-Z\d])to\s+midnight\b/g, '-midnight')
    .replace(/(?<![a-zA-Z\d])until\s+midnight\b/g, '-midnight')
    // "til midnight" → "-midnight"  (already normalized by til rule if "4 til midnight")
    .replace(/\btil\s+midnight\b/g, '-midnight')

    // Clean up residual "-midnight" → "midnight" (already handled above but belt+Suspense)
    .replace(/-midnight/g, 'midnight')

    // ── RULE 3: "open" → 2PM (before any other "open" normalization) ──
    // "open-6pm" → "2pm-6pm", "open-6" → "2pm-6", "open to 6pm" → "2pm-6pm", "open 6pm" → "2pm-6pm"
    // Anchored: "open" must be a standalone word, followed by separator/space + digit.
    // Must come BEFORE the final "to"→"-" separator normalization (which only fires for digit-TO-digit).
    .replace(/\bopen\s*-\s*(\d)/g, '2pm-$1')    // "open-6pm" → "2pm-6pm"
    .replace(/\bopen\s+to\s+(\d)/g, '2pm-$1') // "open to 6pm" → "2pm-6pm" (before "to"→"-" final pass)
    .replace(/\bopen\s+til\s+(\d)/g, '2pm-$1') // "open til 7pm" → "2pm-7pm"
    .replace(/\bopen\s+(\d)/g, '2pm-$1')      // "open 6pm" (bare) → "2pm-6pm"
    // "open at" → "2pm" (venue opens at 2pm HH)
    .replace(/\bopen\s+at\b/g, '2pm')

    // "close" / "closing" → canonical "close"
    .replace(/\bclosings?\b/g, 'close')

    // ── PREFIX WORD STRIPPING ──
    // "from X" / "starting at X" / "starts at X" → strip prefix, keep time
    .replace(/\bfrom\s+/g, '')
    .replace(/\bstarting\s+at\b/g, '')
    .replace(/\bstarts?\s+at\b/g, '')

    // "happy hour" / "happy hour" → strip (doesn't add semantic meaning)
    .replace(/\bhap*y\s*hour\b/gi, '')

    // ── FINAL: strip remaining "to"/"til"/"until"/"through" as separators ──
    // Only fire when surrounded by identifiable token characters.
    // After all above: "X to Y" where X and Y are times or days has been normalized.
    // This catches any remaining "to"/"through" that are truly standalone separators.
    // "til close" and "to close" already handled above; "till" also preserved.
    // e.g. "open to 6pm" — "open" is now a time anchor, "to 6pm" normalized to "-6pm" above.
    .replace(/\s+to\s+/g, '-')          // "open to 6pm" → "open-6pm" (already handled by til rule, belt+Suspense)
    .replace(/\s+until\s+/g, '-')
    .replace(/\s+through\s+/g, '-')

    // Normalize "X-close" (hyphenated) and "X close" (spaced) → "X-close" (for classifier)
    // These are read by classifyHHType's late_night pattern, preserve the dash.
    .replace(/\s+-+\s*close\b/g, '-close')

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

  let { type, adjustedText } = classifyHHType(lower)

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

  // ── LATE NIGHT with explicit time: "4pm-close", "10pm to close" ─
  // classifyHHType stripped the "close" keyword; if adjustedText has trailing "-",
  // strip it so parseTimeToMin can read the time.
  if (type === 'late_night' && adjustedText) {
    const timeOnly = adjustedText.replace(/\s*-\s*$/, '').trim()
    if (/^\d/.test(timeOnly)) {
      const parsed = parseTimeToMin(timeOnly)
      if (parsed !== null) {
        return { type: 'late_night', days: [], excludeDays: [], startMin: parsed, endMin: null }
      }
    }
    // Empty after strip → "after midnight" / "midnight to close" case
    if (!timeOnly) {
      return { type: 'late_night', days: [], excludeDays: [], startMin: 0, endMin: null }
    }
  }

  // ── NO EXPLICIT TIME for late_night ──────────────────────────────
  if (!adjustedText && type === 'late_night') {
    // "after midnight" — adjustedText is empty but type is late_night
    // → midnight to close (startMin=0, endMin=null)
    return { type: 'late_night', days: [], excludeDays: [], startMin: 0, endMin: null }
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

    if (type === 'late_night') {
      // "10pm-close": end is implicit (bar close), start is explicit
      startMin = startMin ?? parseTimeToMin(startStr + (suffix || ''))
      endMin = null
    }
    // Rule 2: cross-midnight — bare range where PM→PM makes end < start → next-day AM
    if (startMin !== null && endMin !== null && endMin < startMin) {
      if (endMin >= 12 * 60) endMin -= 12 * 60
      type = 'late_night'
    }
  }

  // ── TIME RANGE PARSER (no opening_hours.js dependency) ─────────────
  // Handles all formats including no-whitespace: "3pm-5", "3:30pm-9pm", "4:30pm-7"
  if (startMin === null && endMin === null && timePortion && /^\d/.test(timePortion)) {
    // Pattern: "H:mm[am|pm]-H:mm[am|pm]" — am/pm suffix on EACH side independently
    // Handles: "3pm-5", "3pm-5pm", "3:30pm-9pm", "4:30pm-7", "4:30pm-7pm"
    // No spaces required around the separator dash.
    const robustRange = timePortion.match(
      /^(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm|p\.?m\.?))?\s*[-–—to]+\s*(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm|p\.?m\.?))?$/i
    )

    if (robustRange) {
      const [, rawStartH, rawStartM, startSuffix, rawEndH, rawEndM, endSuffix] = robustRange

      // Parse start time: use explicit suffix on start, or fall back to 'pm' for bare ≥ 4
      let startStr = rawStartM ? `${rawStartH}:${rawStartM}` : rawStartH
      let startSuffixStr = startSuffix
        ?? (!endSuffix && parseInt(rawStartH) >= 4 ? 'pm' : '')
      startMin = parseTimeToMin(startStr + (startSuffixStr || ''))

      // Parse end time: use explicit suffix on end, or fall back to 'pm' for bare ≥ 4
      let endStr = rawEndM ? `${rawEndH}:${rawEndM}` : rawEndH
      let endSuffixStr = endSuffix
        ?? (!startSuffix && parseInt(rawEndH) >= 4 ? 'pm' : '')
      endMin = parseTimeToMin(endStr + (endSuffixStr || ''))

      // If end still null (e.g. bare "5" with no suffix and rawNum < 4), treat as pm
      if (endMin === null && !endSuffix && !startSuffix) {
        endMin = parseTimeToMin(endStr + 'pm')
      }
      // Cross-midnight: end before start means the range runs into next morning
      if (startMin !== null && endMin !== null && endMin < startMin) {
        if (endMin >= 12 * 60) endMin -= 12 * 60 // undo wrong PM assumption → AM
        type = 'late_night'
      }
    } else if (type === 'late_night' && /^\d/.test(timePortion)) {
      // Single time expression without a range (e.g. "10pm" in "10pm to midnight")
      // → parse it as the start time, end is implicit close
      const single = parseTimeToMin(timePortion.trim())
      if (single !== null) {
        startMin = single
        endMin = null
      }
    }
  }


  // ── "(time) midnight": "10pm-midnight", "10pm to midnight" → typical, end=midnight ──
  // normalizeText collapses these to "10pm midnight" (space-separated); parse leading time, end=1440
  if (startMin === null && endMin === null) {
    const midnightEnd = adjustedText.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|p\.?m\.?)?[\s-]*midnight$/i)
    if (midnightEnd) {
      const hasPm = /pm|p\.?m\.?/i.test(midnightEnd[3] ?? '')
      const rawN = parseInt(midnightEnd[1])
      const sfx = hasPm ? 'pm' : (rawN >= 4 ? 'pm' : '')
      const parsedStart = parseTimeToMin(midnightEnd[1] + (midnightEnd[2] ? ':' + midnightEnd[2] : '') + sfx)
      if (parsedStart !== null) {
        startMin = parsedStart
        endMin = 1440
        type = 'typical'
      }
    }
  }

  // ── LATE NIGHT "X-close" / "after X" / "midnight": e.g. "10pm-close", "after 9", "midnight" ──
  if (type === 'late_night' && startMin === null && endMin === null) {
    // e.g. "10pm-close", "10-close", "10 p.m. to close", "4-close", "after 9", "after 10"
    const lnMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|p\.?m\.?)?\s*[-–—to]*\s*close/i)
    if (lnMatch) {
      const hasExplicitPm = /pm|p\.?m\.?/i.test(lnMatch[0])
      const hasExplicitAm = /am|a\.?m\.?/i.test(lnMatch[0])
      const rawNum = parseInt(lnMatch[1])
      const assumePm = !hasExplicitPm && !hasExplicitAm && rawNum >= 4
      const suffix = hasExplicitPm ? 'pm' : (hasExplicitAm ? 'am' : (assumePm ? 'pm' : ''))
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

      } else if (adjustedText === '12') {
        // "after 12" — "after" was stripped by classifyHHType, leaving just "12"
        // In late_night context, "12" means midnight (start of day), not noon
        // → startMin=0 (midnight), endMin=null (close)
        startMin = 0
        endMin = null
      } else if (adjustedText === 'midnight') {
        // "midnight" as adjustedText: two cases
        // 1. startMin already set → "midnight" is the END time (e.g. "10pm-midnight")
        //    → set endMin=1440 (midnight as END of window), leave startMin as-is
        // 2. startMin is null → "midnight to close" (no start specified)
        //    → startMin=0 (midnight as START of window = 00:00), endMin=null (close)
        if (startMin !== null) {
          endMin = 1440
        } else {
          startMin = 0
          endMin = null
        }
      } else if (adjustedText?.startsWith('midnight-')) {
        // "midnight-2am" → start=midnight (0), end=2am (120), type=late_night
        const endPart = adjustedText.replace('midnight-', '')
        const endMatch = endPart.match(/^(\d{1,2})(?::(\d{2}))?\s*(am)?$/i)
        if (endMatch) {
          const endHour = parseInt(endMatch[1])
          const suffix = endMatch[3] ? 'am' : (endHour <= 12 ? 'am' : 'pm')
          const parsedEnd = parseTimeToMin(endHour + (endMatch[2] ? ':' + endMatch[2] : '') + suffix)
          if (parsedEnd !== null) {
            startMin = 0
            endMin = parsedEnd
            type = 'late_night'
          }
        }
      }
    }
  }

  // RULE 3: bare "open" → 2pm to close (late_night)
  // normalizeText leaves bare "open" unchanged; classifyHHType returns typical with adjustedText="open"
  // The time extraction above skips "open" (no digits), so handle it here.
  if (type === 'typical' && startMin === null && endMin === null && adjustedText === 'open') {
    return { type: 'late_night', days: days.length > 0 ? days : [], excludeDays: [], startMin: 840, endMin: null }
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
    return { windows: [null, null, null], rawText: text, totalParsed: 0 }
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

  return { windows, rawText: text, totalParsed: stored.length }
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
