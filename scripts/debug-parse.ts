// Standalone debug — copy of classifyHHType + normalizeText + parseOneClause from parse-hh.ts
// Does NOT import — confirms the logic independently

function parseTimeToMin(timeStr) {
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

function normalizeText(text) {
  return text
    .toLowerCase()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*–\s*/g, '-')
    .replace(/\s*—\s*/g, '-')
    .replace(/(?<![a-z])to\s+(?:the\s+)?close\b/g, 'close')
    .replace(/(?<![a-z])until\s+(?:the\s+)?close\b/g, 'close')
    .replace(/\btil\s+close\b/g, 'till close')
    .replace(/(?<![a-zA-Z\d])to\s+midnight\b/g, '-midnight')
    .replace(/(?<![a-zA-Z\d])until\s+midnight\b/g, '-midnight')
    .replace(/\btil\s+midnight\b/g, '-midnight')
    .replace(/-midnight/g, 'midnight')
    .replace(/\bfrom\s+/g, '')
    .replace(/\bstarting\s+at\b/g, '')
    .replace(/\bstarts?\s+at\b/g, '')
    .replace(/\bhap*y\s*hour\b/gi, '')
    .replace(/([a-z])\s*(?:til|till|to)\s*([a-z])/gi, '$1-$2')
    .replace(/(\d)\s*(?:til|till|to)\s*(\d)/g, '$1-$2')
    .replace(/\bthru\b/g, 'through')
    .replace(/\s+/g, ' ').trim()
}

function classifyHHType(text) {
  const lower = normalizeText(text)
  if (/\b(all\s?day|24\s*[\/\\]?\s*7|24\s*hours?|around\s*the\s*clock)\b/.test(lower)) {
    const adjusted = lower.replace(/\b(all\s?day|24\s*[\/\\]?\s*7|24\s*hours?|around\s*the\s*clock)\b/gi, '').trim()
    return { type: 'all_day', adjustedText: adjusted }
  }
  if (/\b(open\s*(through|til|till|to|t'\s*t|thru)|until|til|till|thru|before)\b/.test(lower)) {
    const adjusted = lower
      .replace(/\b(open\s*(through|til|till|to|t'\s*t|thru))\b/gi, '')
      .replace(/\b(until|til|till|thru|before)\b/gi, '')
      .trim()
    return { type: 'open_through', adjustedText: adjusted }
  }
  if (/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only|close|to\s*midnight|till\s*midnight|after\s+\d+|after\s+midnight)\b/.test(lower)) {
    const adjusted = lower
      .replace(/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only|close)\b/gi, '')
      .replace(/\bto\s*midnight\b/gi, '')
      .replace(/\btill\s+midnight\b/gi, '')
      .replace(/\bafter\s+\d+\b/gi, '')
      .replace(/\bafter\s+midnight\b/gi, '')
      .replace(/-midnight/, 'midnight')
      .trim()
    return { type: 'late_night', adjustedText: adjusted }
  }
  if (/\bmidnight\s+to\s+close\b/.test(lower)) {
    return { type: 'late_night', adjustedText: 'midnight' }
  }
  return { type: 'typical', adjustedText: lower }
}

function parseOneClause(text) {
  const lower = text.trim()
  if (!lower) return null
  const { type, adjustedText } = classifyHHType(lower)
  console.log('[DEBUG] lower=', JSON.stringify(lower), 'adjustedText=', JSON.stringify(adjustedText), 'type=', type)
  let startMin = null, endMin = null
  const dayTimeMatch = adjustedText.match(/^([a-zA-Z\-,]+)\s+(.+)$/)
  let timePortion = adjustedText, days = []
  if (dayTimeMatch) { timePortion = dayTimeMatch[2].trim() }
  const rangeMatch = timePortion.match(/^(\d{1,2})(?::(\d{2}))?\s*[-–—to ]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i)
  if (rangeMatch) {
    const startSuffix = rangeMatch[5] || 'pm'
    const endSuffix = rangeMatch[5] || ''
    startMin = parseTimeToMin((rangeMatch[2] ? rangeMatch[1]+':'+rangeMatch[2] : rangeMatch[1]) + startSuffix)
    endMin = parseTimeToMin((rangeMatch[4] ? rangeMatch[3]+':'+rangeMatch[4] : rangeMatch[3]) + endSuffix)
    if (type === 'open_through') { endMin = endMin ?? parseTimeToMin(rangeMatch[3]+(rangeMatch[5]||'')); startMin = startMin ?? 840 }
    else if (type === 'late_night') { startMin = startMin ?? parseTimeToMin(rangeMatch[1]+(rangeMatch[5]||'')); endMin = null }
  }
  if (type === 'open_through' && startMin === null && endMin === null) {
    const bareMatch = adjustedText.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|p|a)?$/i)
    console.log('[DEBUG bareMatch] matched:', bareMatch, 'adjustedText:', JSON.stringify(adjustedText))
    if (bareMatch) {
      const [, , rawSuffix] = bareMatch
      const hasExplicitAm = /am|a\.m\.|a$/i.test(rawSuffix ?? '')
      const hasExplicitPm = /pm|p\.m\.|p$/i.test(rawSuffix ?? '')
      const rawMin = parseTimeToMin(bareMatch[0])
      console.log('[DEBUG] rawSuffix:', JSON.stringify(rawSuffix), 'hasExplicitAm:', hasExplicitAm, 'rawMin:', rawMin)
      if (rawMin !== null) {
        if (hasExplicitAm) { endMin = rawMin }
        else if (hasExplicitPm) { endMin = rawMin }
        else { endMin = rawMin < 720 ? rawMin + 720 : rawMin }
        startMin = 840
      }
    }
  }
  return { type, days, excludeDays: [], startMin, endMin }
}

console.log('--- normalizeText ---')
console.log('before 2am:', JSON.stringify(normalizeText('before 2am')))
console.log('10pm to midnight:', JSON.stringify(normalizeText('10pm to midnight')))
console.log('--- classifyHHType ---')
console.log('before 2am:', JSON.stringify(classifyHHType('before 2am')))
console.log('10pm to midnight:', JSON.stringify(classifyHHType('10pm to midnight')))
console.log('--- parseOneClause ---')
console.log('before 2am:', JSON.stringify(parseOneClause('before 2am')))
console.log('10pm to midnight:', JSON.stringify(parseOneClause('10pm to midnight')))
