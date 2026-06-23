// Direct test of classifyHHType for after inputs
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
  const r = classifyHHType(t);
  console.log(t, '→', JSON.stringify(r));
}
