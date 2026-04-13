/**
 * Checks if a venue's menu text currently qualifies as having an active happy hour.
 * Accounts for time windows, day-of-week restrictions, and HH terminology.
 */
export function hasActiveHappyHour(menuText: string | null | undefined): boolean {
  if (!menuText) return false

  const now = new Date()
  const currentDay = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][now.getDay()]
  const currentHour = now.getHours()

  const text = menuText.toLowerCase()

  // Pattern 1: Explicit time windows like "3-6pm", "4pm - 7pm", "5 to 8"
  const timeWindowMatch = text.match(
    /\b(\d{1,2})\s*[-–—to]+\s*(\d{1,2})(pm|am)?\b/i
  )
  if (timeWindowMatch) {
    let startHour = parseInt(timeWindowMatch[1])
    let endHour = parseInt(timeWindowMatch[2])
    const suffix = timeWindowMatch[3]?.toLowerCase()

    if (suffix === 'am' && endHour < 12) endHour += 12
    if (suffix === 'pm' && startHour < 12) startHour += 12
    if (!suffix && endHour < 12) endHour += 12

    if (currentHour >= startHour && currentHour < endHour) return true
  }

  // Pattern 2: Day-of-week with time, e.g. "Mon-Fri 4-7pm"
  const dayMatch = text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)
  if (dayMatch) {
    const mentionedDay = dayMatch[1].toLowerCase()
    if (mentionedDay === currentDay && /\b(\d{1,2})\s*[-–—to]+\s*(\d{1,2})(pm|am)?\b/i.test(text)) {
      return true
    }
  }

  // Pattern 3: Day range like "Mon-Fri" (assumes weekdays include today unless weekend)
  const rangeMatch = text.match(/\b(mon|tue|wed|thu|fri|sat|sun)[sd]?\s*[-–—to]+\s*(mon|tue|wed|thu|fri|sat|sun)[sd]?\b/i)
  if (rangeMatch && !text.includes('saturday') && !text.includes('sunday')) {
    const isWeekend = currentDay === 'saturday' || currentDay === 'sunday'
    if (!isWeekend && /\b(\d{1,2})\s*[-–—to]+\s*(\d{1,2})(pm|am)?\b/i.test(text)) return true
  }

  // Pattern 4: HH terminology without explicit day/time restrictions
  if (/\bhh\b|\bh\.?h\.?\b|happy\s*hour|angry\s*hour\b/i.test(text)) {
    if (!/\bno\s*hh\b|\bno\s*happy\s*hour\b|\bhh\s*ended\b/i.test(text)) {
      const anyTimeMatch = /\b(\d{1,2})\s*[-–—to]+\s*(\d{1,2})(pm|am)?\b/i.test(text)
      if (anyTimeMatch || !/\b(closed|ended|over|done)\b/i.test(text)) return true
    }
  }

  return false
}