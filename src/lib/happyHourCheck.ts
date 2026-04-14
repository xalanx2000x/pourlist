/**
 * Checks if extracted menu text contains happy hour indicators.
 * Returns an object with isHappyHour signal, list of detected signals,
 * and matched time substrings.
 */
export function checkHappyHour(
  text: string
): { isHappyHour: boolean; signals: string[]; times: string[] } {
  const lower = text.toLowerCase()

  const signals: string[] = []
  const times: string[] = []

  // Time windows regex — capture the actual matched substring
  // Uses - (hyphen) at start/end of char class to avoid range interpretation issues
  const DASH = '[-—–]' // hyphen, em-dash, en-dash
  const TIME_WINDOW_RE = new RegExp(
    `\\b(\\d{1,2}(?::\\d{2})?\\s*${DASH}\\s*[-—–to]+\\s*\\d{1,2}(?::\\d{2})?\\s*(?:pm|am)\\b|` +
    `\\b(\\d{1,2}(?::\\d{2})?\\s*(?:pm|am)\\s*${DASH}\\s*[-—–to]+\\s*\\d{1,2}(?::\\d{2})?\\s*(?:pm|am)\\b)`,
    'gi'
  )
  const TIME_WINDOW_RE2 = new RegExp(
    `\\b(\\d{1,2}\\s*${DASH}\\s*\\d{1,2}\\s*(?:pm|am))\\b`,
    'gi'
  )
  // Extract all time windows
  let m: RegExpExecArray | null
  const foundTimes = new Set<string>()
  while ((m = TIME_WINDOW_RE.exec(text)) !== null) {
    foundTimes.add(m[1])
  }
  while ((m = TIME_WINDOW_RE2.exec(text)) !== null) {
    foundTimes.add(m[1])
  }
  times.push(...Array.from(foundTimes))

  if (times.length > 0) signals.push('Time window detected')

  // Explicit happy hour mentions (including common variations/spellings)
  if (/\bhh\b|\bh\.?h\.?\b|happy\s*hour|angry\s*hour|happy\s*hr\b|angry\s*hr\b/i.test(lower)) {
    signals.push('Happy Hour explicitly mentioned')
  }

  // Discount language: "$5", "50% off", "$2 off", "half price", etc.
  if (/\$[\d]+(?:\.\d{2})?|\d+\s*%?\s*off|\bhalf\s*price\b|\bdiscount\b|\bspecial\b|\bdeal\b|\bcheap\b|\b\$1[0-9]\b|\bunder\s*\$\d+/i.test(lower)) {
    signals.push('Discount or price signal')
  }

  // HH-specific food/bev items (small plates, bar bites, discounted well drinks, etc.)
  if (/\bwell\s*(drink|water)?\b|\bhouse\s*(wine|drink)\b|\bwells?\b|\brail\s*(drink)?\b|\bshot[s]?\b|\bappetizer[s]?\b|\bsmall\s*plate[s]?\b|\bbar\s*bite[s]?\b|\btapas?\b|\bknuckle\s*sandwich\b/i.test(lower)) {
    signals.push('HH-style food/drink items')
  }

  // Days of week with times — common on HH schedules
  if (/\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)[sd]?\b.*\b\d+\b/i.test(lower)) {
    signals.push('Day-of-week schedule detected')
  }

  // "Until" / "All day" / "During" language
  if (/\buntil\b|\btil\b|\ball\s*day\b|\bduring\s*happy\b/i.test(lower)) {
    signals.push('Duration language')
  }

  return {
    isHappyHour: signals.length >= 1,
    signals,
    times
  }
}
