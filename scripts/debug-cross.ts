// Debug cross-midnight: trace raw startMin/endMin from BOTH rangeMatch AND robustRange
// Isolated copy of parsing logic from parse-hh.ts

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
  if (/\b(open\s*(through|til|till|to|t'\s*t|thru)|until|til|till|thru|before)\b/.test(lower)) {
    const adjusted = lower.replace(/\b(until|til|till|thru|before)\b/gi, '').trim()
    return { type: 'open_through', adjustedText: adjusted }
  }
  return { type: 'typical', adjustedText: lower }
}

function traceRangeMatch(input: string) {
  const { type, adjustedText } = classifyHHType(input)
  const timePortion = adjustedText

  // rangeMatch: single trailing suffix
  const rangeMatch = timePortion.match(
    /^(\d{1,2})(?::(\d{2}))?\s*[-–—to ]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i
  )

  if (rangeMatch) {
    const rawStart = rangeMatch[1]
    const rawStartMin = rangeMatch[2]
    const rawEnd = rangeMatch[3]
    const rawEndMin = rangeMatch[4]
    const suffix = rangeMatch[5] ?? ''

    const startStr = rawStartMin ? `${rawStart}:${rawStartMin}` : rawStart
    const endStr = rawEndMin ? `${rawEnd}:${rawEndMin}` : rawEnd

    const startSuffix = suffix || 'pm'
    const endSuffix = suffix || ''

    let startMin: number | null = parseTimeToMin(startStr + startSuffix)
    let endMin: number | null = parseTimeToMin(endStr + endSuffix)

    if (endMin === null && !suffix && endStr) {
      endMin = parseTimeToMin(endStr + 'pm')
    }

    if (type === 'open_through') {
      endMin = endMin ?? parseTimeToMin(endStr + (suffix || ''))
      startMin = startMin ?? (14 * 60)
    } else if (type === 'late_night') {
      startMin = startMin ?? parseTimeToMin(startStr + (suffix || ''))
      endMin = null
    }

    console.log(`  [rangeMatch] input="${input}" type=${type}`)
    console.log(`    rangeMatch[5] (suffix)="${suffix}" startSuffix="${startSuffix}" endSuffix="${endSuffix}"`)
    console.log(`    startStr="${startStr}" endStr="${endStr}"`)
    console.log(`    startMin=${startMin} endMin=${endMin}`)
    console.log(`    cross-midnight? endMin(${endMin}) < startMin(${startMin}) → ${endMin !== null && startMin !== null ? endMin < startMin : 'N/A'}`)
    return
  }

  // robustRange: separate suffixes on each side
  const robustRange = timePortion.match(
    /^(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm|p\.?m\.?))?\s*[-–—to]+\s*(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm|p\.?m\.?))?$/i
  )

  if (robustRange) {
    const [, rawStartH, rawStartM, startSuffix, rawEndH, rawEndM, endSuffix] = robustRange
    let startStr = rawStartM ? `${rawStartH}:${rawStartM}` : rawStartH
    let startSuffixStr = startSuffix
      ?? (!endSuffix && parseInt(rawStartH) >= 4 ? 'pm' : '')
    let startMin: number | null = parseTimeToMin(startStr + (startSuffixStr || ''))
    let endStr = rawEndM ? `${rawEndH}:${rawEndM}` : rawEndH
    let endSuffixStr = endSuffix
      ?? (!startSuffix && parseInt(rawEndH) >= 4 ? 'pm' : '')
    let endMin: number | null = parseTimeToMin(endStr + (endSuffixStr || ''))

    if (endMin === null && !endSuffix && !startSuffix) {
      endMin = parseTimeToMin(endStr + 'pm')
    }

    if (type === 'open_through') {
      endMin = endMin ?? parseTimeToMin(endStr + (endSuffix || ''))
      startMin = startMin ?? (14 * 60)
    } else if (type === 'late_night') {
      startMin = startMin ?? parseTimeToMin(startStr + (startSuffix || ''))
      endMin = null
    }

    console.log(`  [robustRange] input="${input}" type=${type}`)
    console.log(`    robustRange: startSuffix="${startSuffix}" endSuffix="${endSuffix}"`)
    console.log(`    startStr="${startStr}" endStr="${endStr}"`)
    console.log(`    startSuffixStr="${startSuffixStr}" endSuffixStr="${endSuffixStr}"`)
    console.log(`    startMin=${startMin} endMin=${endMin}`)
    console.log(`    cross-midnight? endMin(${endMin}) < startMin(${startMin}) → ${endMin !== null && startMin !== null ? endMin < startMin : 'N/A'}`)
    return
  }

  console.log(`  ❌ NO MATCH: "${input}" (adjustedText="${adjustedText}")`)
}

const inputs = ['10-2', '10pm-2', '6-4', '10pm-2am', '11pm-1am']
for (const input of inputs) {
  console.log(`\n=== ${input} ===`)
  traceRangeMatch(input)
}
