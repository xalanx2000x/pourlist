// Standalone: normalizeText + classifyHHType for "after 9pm"
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
  const lower = text.toLowerCase()
  if (/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only|close|to\s*midnight|till\s+midnight|after\s+\d+|after\s+midnight)\b/.test(lower)) {
    const adjusted = lower
      .replace(/\b(to\s+close|until\s+close|til\s+close|till\s+close|close\s+only|close)\b/gi, '')
      .replace(/\bto\s+midnight\b/gi, '')
      .replace(/\btill\s+midnight\b/gi, '')
      .replace(/\bafter\s+\d+(?::\d{2})?\s*(?:am|pm|p\.?m\.?)?/gi, '') // strip "after 9pm", "after 12" etc
      .replace(/\bafter\s+midnight\b/gi, '')
      .replace(/-midnight/, 'midnight')
      .trim()
    return { type: 'late_night', adjustedText: adjusted }
  }
  if (/\b(open\s*(through|til|till|to|t'\s*t|thru)|until|til|till|thru|before)\b/.test(lower)) {
    const adjusted = lower.replace(/\b(until|til|till|thru|before)\b/gi, '').trim()
    return { type: 'open_through', adjustedText: adjusted }
  }
  return { type: 'typical', adjustedText: lower }
}

const tests = ['after 9pm', 'after 10pm', 'after midnight', 'after 12', 'after 9', 'after 12am'];
for (const t of tests) {
  const norm = normalizeText(t);
  const cls = classifyHHType(norm);
  console.log(t);
  console.log('  normalizeText:', JSON.stringify(norm));
  console.log('  classifyHHType:', JSON.stringify(cls));
  console.log();
}
