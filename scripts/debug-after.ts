// Debug: trace classifyHHType output + afterMatch captures for Ruling 2 inputs
// Isolated copy of relevant logic from parse-hh.ts

function parseTimeToMin(timeStr: string): number | null {
  const s = timeStr.trim().toLowerCase()
  if (s === 'midnight') return 0
  if (s === 'noon') return 720
  if (s === 'open') return null
  if (s === 'close') return null
  const colonPmMatch = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm|p\.m\.?)?$/i)
  if (colonPmMatch) {
    let h = parseInt(colonPmMatch[1])
    const m = parseInt(colonPmMatch[2])
    const suffix = (colonPmMatch[3] || '').toLowerCase()
    if (suffix === 'am') { if (h === 12) h = 0 }
    else if (h < 12) h += 12
    return h * 60 + m
  }
  const pmMatch = s.match(/^(\d{1,2})\s*(p|pm|p\.m\.?)?$/i)
  if (pmMatch) {
    let h = parseInt(pmMatch[1])
    if (h === 12) h = 12
    else if (h < 12) h += 12
    return h * 60
  }
  const amMatch = s.match(/^(\d{1,2})\s*(a|am|a\.m\.?)?$/i)
  if (amMatch) {
    let h = parseInt(amMatch[1])
    if (h === 12) h = 0
    return h * 60
  }
  const colonMatch = s.match(/^(\d{1,2})(?::(\d{2}))?$/)
  if (colonMatch) {
    const h = parseInt(colonMatch[1])
    const m = colonMatch[2] ? parseInt(colonMatch[2]) : 0
    if (h < 0 || h > 24 || m < 0 || m > 59) return null
    if (h === 24) return 24 * 60
    return h * 60 + m
  }
  return null
}

function classifyHHType(text: string): { type: string; adjustedText: string } {
  const lower = text.toLowerCase()
  // LATE_NIGHT: "to close", "to midnight", "after X", etc.
  if (/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only|close|to\s*midnight|till\s*midnight|after\s+\d+|after\s+midnight)\b/.test(lower)) {
    const adjusted = lower
      .replace(/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only|close)\b/gi, '')
      .replace(/\bto\s*midnight\b/gi, '')
      .replace(/\btill\s+midnight\b/gi, '')
      .replace(/\bafter\s+\d+\b/gi, '')      // strips "after 12" but NOT "after 9pm"
      .replace(/\bafter\s+midnight\b/gi, '')
      .replace(/-midnight/, 'midnight')
      .trim()
    return { type: 'late_night', adjustedText: adjusted }
  }
  // OPEN THROUGH: "open through", "until", "til", "before"
  if (/\b(open\s*(through|til|till|to|t'\s*t|thru)|until|til|till|thru|before)\b/.test(lower)) {
    const adjusted = lower.replace(/\b(until|til|till|thru|before)\b/gi, '').trim()
    return { type: 'open_through', adjustedText: adjusted }
  }
  return { type: 'typical', adjustedText: lower }
}

function traceAfter(input: string) {
  const { type, adjustedText } = classifyHHType(input)
  const lower = input.toLowerCase()

  console.log(`  input="${input}"`)
  console.log(`    classifyHHType → type="${type}" adjustedText="${adjustedText}"`)

  // Test afterMatch in late_night context
  if (type === 'late_night') {
    const afterMatch = lower.match(/\bafter\s+(\d{1,2})(?::(\d{2}))?(?:\s*(?:am|pm|p\.?m\.?))?/i)
    console.log(`    afterMatch:`, afterMatch)
    if (afterMatch) {
      const hasExplicitPm = /pm|p\.?m\.?/i.test(afterMatch[0])
      const rawNum = parseInt(afterMatch[1])
      const assumePm = !hasExplicitPm && !/am/i.test(afterMatch[0]) && rawNum >= 4
      const suffix = hasExplicitPm ? 'pm' : (assumePm ? 'pm' : '')
      const startMin = parseTimeToMin(afterMatch[1] + (afterMatch[2] ? ':' + afterMatch[2] : '') + suffix)
      console.log(`    hasExplicitPm=${hasExplicitPm} rawNum=${rawNum} assumePm=${assumePm} suffix="${suffix}"`)
      console.log(`    startMin=${startMin} (expected: ${input.includes('9pm') ? 1320 : input.includes('10pm') ? 1380 : '?'})`)
    }
  }

  // Also test bareMatch in open_through context
  if (type === 'open_through') {
    const bareMatch = adjustedText.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|p|a)?$/i)
    console.log(`    bareMatch (open_through):`, bareMatch)
    if (bareMatch) {
      const rawSuffix = bareMatch[3]
      const hasExplicitAm = /am|a\.m\.|a$/i.test(rawSuffix ?? '')
      const hasExplicitPm = /pm|p\.m\.|p$/i.test(rawSuffix ?? '')
      const rawMin = parseTimeToMin(bareMatch[0])
      console.log(`    rawSuffix="${rawSuffix}" hasExplicitAm=${hasExplicitAm} hasExplicitPm=${hasExplicitPm} rawMin=${rawMin}`)
    }
  }

  console.log()
}

const inputs = ['after 9pm', 'after 10pm', 'after midnight', 'after 12']
for (const input of inputs) {
  console.log(`\n=== ${input} ===`)
  traceAfter(input)
}
