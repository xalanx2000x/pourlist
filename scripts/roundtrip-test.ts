/**
 * HH Round-Trip Test
 *
 * Tests whether format-schedule.ts output is parser-safe: can the formatted
 * text be re-parsed back to the original structured window data?
 *
 * Result as of 2026-07-08 transcript:
 *   0 WIN · 0 PARTIAL · 6 MISMATCH — ZERO formatter outputs are parser-safe.
 *
 * Three known failures (do NOT fix without updating this header):
 *
 * BUG 1 — RANGE1/ROBUST block missing startMin/endMin assignment
 *   The robust time-range regex ("2:00 pm-6:00 pm") matches correctly but
 *   the parsed startMin/endMin values are never assigned to the output object.
 *   All formatted times with :MM (e.g. 4:00 PM, 5:30 PM) return null.
 *   Affects: every venue with H:MM times (all 6 in this test).
 *
 * BUG 2 — normalizeText double-collapses midnight
 *   "12:00 AM" → "midnight" (Rule 1). Then "midnight-midnight" collapses to
 *   "midnight" before the day/time split runs. End result: "midnightmidnight".
 *   Affects: Paymaster Lounge (window 2: "Daily 12:00 AM–midnight").
 *
 * BUG 3 — dayTimeMatch regex can't handle comma-separated day lists
 *   /^([a-zA-Z\-,]+)\s+(.+)$/ stops at the first comma in
 *   "Mon, Tue, Wed, Thu, Fri 4:00 PM–5:30 PM", capturing only "Mon," as
 *   dayPart. parseDayRange("mon,") → [] (trailing comma not handled), leaving
 *   the remainder ("tue, wed, thu, fri 4:00 PM–5:30 PM") as timePortion and
 *   no time extracted.
 *   Affects: any multi-day list with 3+ days (The Star W2, Park City W1+W2,
 *   Schilling W1+W3, Bar Diane both windows, Fulton both windows).
 *
 * Run: node --experimental-vm-modules scripts/roundtrip-test.ts
 *      (or: npx tsx scripts/roundtrip-test.ts if tsx is installed)
 */

import { readFileSync } from 'fs';

// ── Minimal inline copies of the formatter's key helpers ────────────────────

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function formatMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const period = h < 12 ? 'AM' : 'PM';
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour12}:${m.toString().padStart(2, '0')} ${period}`;
}

function formatDays(days: number[], excludeDays: number[] = []): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7 && excludeDays.length === 0) return 'Daily';
  if (sorted.length === 7 && excludeDays.length > 0) {
    if (excludeDays.sort((a, b) => a - b).join(',') === '6,7') return 'Weekdays';
    return `Daily except ${excludeDays.sort((a, b) => a - b).map(d => DAY_SHORT[d - 1]).join(', ')}`;
  }
  if (sorted.length === 2 && sorted[1] - sorted[0] === 1 && [1,2,3,4,5,6].includes(sorted[0]) && sorted[0] + 1 === sorted[1]) {
    return `${DAY_SHORT[sorted[0] - 1]}–${DAY_SHORT[sorted[1] - 1]}`;
  }
  return sorted.map(d => DAY_SHORT[d - 1]).join(', ');
}

function formatWindow(
  type: string | null | undefined,
  daysStr: string | null | undefined,
  startMin: number | null | undefined,
  endMin: number | null | undefined,
  excludeDaysStr: string | null | undefined
): string | null {
  if (!type) return null;
  const days = daysStr ? daysStr.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 7) : [];
  const excludeDays = excludeDaysStr ? excludeDaysStr.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 7) : [];
  const dayLabel = formatDays(days, excludeDays);

  if (type === 'all_day') return dayLabel ? `${dayLabel} all day` : 'All day';
  if (type === 'late_night') {
    if (startMin == null) return dayLabel ? `${dayLabel} late night` : 'Late night';
    const start = formatMin(startMin);
    const end = (endMin != null && endMin !== 0) ? formatMin(endMin) : 'midnight';
    return dayLabel ? `${dayLabel} ${start}–${end}` : `${start}–${end}`;
  }
  if (type === 'typical') {
    if (startMin == null || endMin == null) return null;
    const start = formatMin(startMin);
    const end = endMin !== 0 ? formatMin(endMin) : 'midnight';
    if (!dayLabel) return `${start}–${end}`;
    if (endMin < startMin) return `${dayLabel} ${start}–${end}+`;
    return `${dayLabel} ${start}–${end}`;
  }
  return null;
}

function getHhLabel(w1: string | null, w2: string | null, w3: string | null): string {
  const parts: string[] = [];
  if (w1) parts.push(w1);
  if (w2) parts.push(w2);
  if (w3) parts.push(w3);
  return parts.join(' · ');
}

// ── Inline parse-hh.ts (parseOneClause + parseHHSchedule) ─────────────────────
// NOTE: bugs in this parser are intentional — this is the current source of truth.

const DAY_PREFIXES: Record<string, number> = {
  'm':1,'mo':1,'mon':1,'monday':1,
  'tu':2,'tue':2,'tuesday':2,'w':3,'we':3,'wed':3,'wednesday':3,
  'th':4,'thu':4,'thursday':4,'f':5,'fr':5,'fri':5,'friday':5,
  'sa':6,'sat':6,'saturday':6,'su':7,'sun':7,'sunday':7,
};

function resolveDayPrefix(token: string): number | null {
  return DAY_PREFIXES[token.toLowerCase().trim()] ?? null;
}
function parseDay(dayStr: string): number | null {
  return resolveDayPrefix(dayStr.toLowerCase().trim());
}
function parseDayRange(rangeStr: string): number[] {
  const clean = rangeStr.replace(/\s+/g, '').toLowerCase();
  const days: number[] = [];
  const rangeMatch = clean.match(/^([a-z]+)-([a-z]+)$/);
  if (rangeMatch) {
    const start = parseDay(rangeMatch[1]);
    const end = parseDay(rangeMatch[2]);
    if (start != null && end != null) {
      let cur = start;
      while (true) { days.push(cur); if (cur === end) break; cur = cur === 7 ? 1 : cur + 1; }
    }
    return days;
  }
  const single = parseDay(clean);
  if (single !== null) return [single];
  if (clean === 'weekdays') return [1,2,3,4,5];
  if (clean === 'weekends') return [6,7];
  if (clean === 'everyday' || clean === 'daily') return [1,2,3,4,5,6,7];
  return [];
}

function normalizeText(text: string): string {
  const lower = text.toLowerCase();
  return lower
    .replace(/\b12\s*:\s*00\s*am\b/g, 'midnight').replace(/\b12\s*am\b/g, 'midnight')
    .replace(/\b12\s*:\s*00\s*pm\b/g, 'noon').replace(/\b12\s*pm\b/g, 'noon')
    .replace(/(\d)\s+(?:to|til|till|until)\s+(\d)/g, '$1-$2')
    .replace(/([a-z])\s+(?:til|till|until|to)\s+([a-z])/gi, '$1-$2')
    .replace(/\s*[–—]\s*/g, '-')
    .replace(/(\d)\s+thru\s+(\d)/gi, '$1-$2')
    .replace(/midnight\s*-\s*close/gi, 'midnight').replace(/midnight-close/gi, 'midnight')
    .replace(/(?<![a-z])to\s+(?:the\s+)?close\b/g, 'close')
    .replace(/(?<![a-z])until\s+(?:the\s+)?close\b/g, 'close')
    .replace(/\btil\s+close\b/g, 'till close')
    .replace(/(?<![a-zA-Z\d])to\s+midnight\b/g, '-midnight')
    .replace(/(?<![a-zA-Z\d])until\s+midnight\b/g, '-midnight')
    .replace(/\btil\s+midnight\b/g, '-midnight').replace(/-midnight/g, 'midnight')
    .replace(/\bopen\s*-\s*(\d)/g, '2pm-$1').replace(/\bopen\s+to\s+(\d)/g, '2pm-$1')
    .replace(/\bopen\s+til\s+(\d)/g, '2pm-$1').replace(/\bopen\s+(\d)/g, '2pm-$1')
    .replace(/\bopen\s+at\b/g, '2pm')
    .replace(/\bclosings?\b/g, 'close')
    .replace(/\bfrom\s+/g, '').replace(/\bstarting\s+at\b/g, '').replace(/\bstarts?\s+at\b/g, '')
    .replace(/\bhap*y\s*hour\b/gi, '')
    .replace(/\s+to\s+/g, '-').replace(/\s+until\s+/g, '-').replace(/\s+through\s+/g, '-')
    .replace(/\s+-+\s*close\b/g, '-close')
    .replace(/\s+/g, ' ').trim();
}

function classifyHHType(text: string): { type: string; adjustedText: string } {
  const lower = normalizeText(text);
  if (/\b(all\s?day|24\s*[\/\\]?\s*7|24\s*hours?|around\s*the\s*clock)\b/.test(lower)) {
    const adjusted = lower.replace(/\b(all\s?day|24\s*[\/\\]?\s*7|24\s*hours?|around\s*the\s*clock)\b/gi, '').trim();
    return { type: 'all_day', adjustedText: adjusted };
  }
  if (/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only|close|to\s*midnight|till\s*midnight|after\s+\d+(?::\d{2})?\s*(?:am|pm|p\.?m\.?)?|after\s+midnight)\b/.test(lower)) {
    const adjusted = lower
      .replace(/\b(to\s*close|until\s*close|til\s*close|till\s*close|close\s*only|close)\b/gi, '')
      .replace(/\bto\s*midnight\b/gi, '').replace(/\btill\s*midnight\b/gi, '')
      .replace(/\bafter\s+\d+\b/gi, '').replace(/\bafter\s+midnight\b/gi, '')
      .replace(/-midnight/, 'midnight').trim();
    return { type: 'late_night', adjustedText: adjusted };
  }
  if (/\bmidnight\s+to\s+close\b/.test(lower) || /\bmidnight\s*-\s*close\b/.test(lower)) {
    return { type: 'late_night', adjustedText: 'midnight' };
  }
  if (lower === 'midnight') return { type: 'late_night', adjustedText: 'midnight' };
  if (/\bmidnight\s*-\s*(\d)/.test(lower)) return { type: 'late_night', adjustedText: lower };
  return { type: 'typical', adjustedText: lower };
}

function parseTimeToMin(timeStr: string): number | null {
  const s = timeStr.trim().toLowerCase();
  if (s === 'midnight') return 0;
  if (s === 'noon') return 720;
  if (s === 'open') return null;
  if (s === 'close') return null;
  const colonPmMatch = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm|p\.?m\.?)?$/i);
  if (colonPmMatch) {
    let h = parseInt(colonPmMatch[1]);
    const m = parseInt(colonPmMatch[2]);
    const suffix = (colonPmMatch[3] || '').toLowerCase();
    if (suffix === 'am') { if (h === 12) h = 0; }
    else if (h < 12) h += 12;
    return h * 60 + m;
  }
  const pmMatch = s.match(/^(\d{1,2})\s*(p|pm|p\.?m\.?)?$/i);
  if (pmMatch) {
    let h = parseInt(pmMatch[1]);
    if (h === 12) h = 12;
    else if (h < 12) h += 12;
    return h * 60;
  }
  const amMatch = s.match(/^(\d{1,2})\s*(a|am|a\.?m\.?)?$/i);
  if (amMatch) {
    let h = parseInt(amMatch[1]);
    if (h === 12) h = 0;
    return h * 60;
  }
  const colonMatch = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (colonMatch) {
    const h = parseInt(colonMatch[1]);
    const m = colonMatch[2] ? parseInt(colonMatch[2]) : 0;
    if (h < 0 || h > 24 || m < 0 || m > 59) return null;
    if (h === 24) return 1440;
    return h * 60 + m;
  }
  return null;
}

interface HHWindow { type: string | null; days: number[]; excludeDays: number[]; startMin: number | null; endMin: number | null }

function parseOneClause(text: string): HHWindow | null {
  const lower = text.trim();
  if (!lower) return null;
  let { type, adjustedText } = classifyHHType(lower);

  if (type === 'all_day') {
    let days: number[] = [];
    const afterMatch = lower.match(/\ball\s?day\b\s+([a-z]+)/i);
    if (afterMatch) { const d = parseDay(afterMatch[1]); if (d !== null) days = [d]; }
    if (days.length === 0) {
      const beforeMatch = lower.match(/([a-z]+)\s+\ball\s?day\b/i);
      if (beforeMatch) { const d = parseDay(beforeMatch[1]); if (d !== null) days = [d]; }
    }
    return { type: 'all_day', days, excludeDays: [], startMin: null, endMin: null };
  }

  if (type === 'late_night' && adjustedText) {
    const timeOnly = adjustedText.replace(/\s*-\s*$/, '').trim();
    if (/^\d/.test(timeOnly)) {
      const parsed = parseTimeToMin(timeOnly);
      if (parsed !== null) return { type: 'late_night', days: [], excludeDays: [], startMin: parsed, endMin: null };
    }
    if (!timeOnly) return { type: 'late_night', days: [], excludeDays: [], startMin: 0, endMin: null };
  }
  if (!adjustedText && type === 'late_night') return { type: 'late_night', days: [], excludeDays: [], startMin: 0, endMin: null };

  const dayTimeMatch = adjustedText.match(/^([a-zA-Z\-,]+)\s+(.+)$/);
  let timePortion = adjustedText;
  let days: number[] = [];
  if (dayTimeMatch) {
    const dayPart = dayTimeMatch[1];
    timePortion = dayTimeMatch[2].trim();
    days = parseDayRange(dayPart);
  }

  let startMin: number | null = null, endMin: number | null = null;

  const rangeMatch = timePortion.match(
    /^(\d{1,2})(?::(\d{2}))?\s*[-–—to ]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i
  );
  if (rangeMatch) {
    const rawStart = rangeMatch[1], rawStartMin = rangeMatch[2], rawEnd = rangeMatch[3], rawEndMin = rangeMatch[4];
    const suffix = rangeMatch[5] ?? '';
    const startStr = rawStartMin ? `${rawStart}:${rawStartMin}` : rawStart;
    const endStr = rawEndMin ? `${rawEnd}:${rawEndMin}` : rawEnd;
    const startSuffix = suffix || 'pm';
    const endSuffix = suffix || '';
    startMin = parseTimeToMin(startStr + startSuffix);
    endMin = parseTimeToMin(endStr + endSuffix);
    if (endMin === null && !suffix && endStr) endMin = parseTimeToMin(endStr + 'pm');
    if (type === 'late_night') { startMin = startMin ?? parseTimeToMin(startStr + (suffix || '')); endMin = null; }
    if (startMin !== null && endMin !== null && endMin < startMin) {
      if (endMin >= 720) endMin -= 720;
      type = 'late_night';
    }
  }

  if (startMin === null && endMin === null && timePortion && /^\d/.test(timePortion)) {
    const robustRange = timePortion.match(
      /^(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm|p\.?m\.?))?\s*[-–—to]+\s*(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm|p\.?m\.?))?$/i
    );
    if (robustRange) {
      // BUG 1: robustRange matches "2:00 pm-6:00 pm" correctly, but the
      // startMin/endMin assignment block is missing here — values are never set.
      const [, rawStartH, rawStartM, startSuffix, rawEndH, rawEndM, endSuffix] = robustRange;
      let startStr = rawStartM ? `${rawStartH}:${rawStartM}` : rawStartH;
      let startSuffixStr = startSuffix ?? (!endSuffix && parseInt(rawStartH) >= 4 ? 'pm' : '');
      startMin = parseTimeToMin(startStr + (startSuffixStr || ''));
      let endStr = rawEndM ? `${rawEndH}:${rawEndM}` : rawEndH;
      let endSuffixStr = endSuffix ?? (!startSuffix && parseInt(rawEndH) >= 4 ? 'pm' : '');
      endMin = parseTimeToMin(endStr + (endSuffixStr || ''));
      if (endMin === null && !endSuffix && !startSuffix) endMin = parseTimeToMin(endStr + 'pm');
      if (startMin !== null && endMin !== null && endMin < startMin) {
        if (endMin >= 720) endMin -= 720;
        type = 'late_night';
      }
    } else if (type === 'late_night' && /^\d/.test(timePortion)) {
      const single = parseTimeToMin(timePortion.trim());
      if (single !== null) { startMin = single; endMin = null; }
    }
  }

  if (startMin === null && endMin === null) {
    // BUG 2: "12:00 AM–midnight" arrives here as "midnightmidnight" after
    // normalizeText's double-collapse of "12:00 AM" → "midnight" → "midnight".
    const midnightEnd = adjustedText.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|p\.?m\.?)?[\s-]*midnight$/i);
    if (midnightEnd) {
      const hasPm = /pm|p\.?m\.?/i.test(midnightEnd[3] ?? '');
      const rawN = parseInt(midnightEnd[1]);
      const sfx = hasPm ? 'pm' : (rawN >= 4 ? 'pm' : '');
      const parsedStart = parseTimeToMin(midnightEnd[1] + (midnightEnd[2] ? ':' + midnightEnd[2] : '') + sfx);
      if (parsedStart !== null) { startMin = parsedStart; endMin = 1440; type = 'typical'; }
    }
  }

  if (type === 'late_night' && startMin === null && endMin === null) {
    const lnMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|p\.?m\.?)?\s*[-–—to]*\s*close/i);
    if (lnMatch) {
      const hasExplicitPm = /pm|p\.?m\.?/i.test(lnMatch[0]);
      const hasExplicitAm = /am|a\.?m\.?/i.test(lnMatch[0]);
      const rawNum = parseInt(lnMatch[1]);
      const assumePm = !hasExplicitPm && !hasExplicitAm && rawNum >= 4;
      const suffix = hasExplicitPm ? 'pm' : (hasExplicitAm ? 'am' : (assumePm ? 'pm' : ''));
      startMin = parseTimeToMin(lnMatch[1] + (lnMatch[2] ? ':' + lnMatch[2] : '') + suffix);
      endMin = null;
    } else {
      const afterMatch = lower.match(/\bafter\s+(\d{1,2})(?::(\d{2}))?(?:\s*(?:am|pm|p\.?m\.?))?/i);
      if (afterMatch) {
        const hasExplicitPm = /pm|p\.?m\.?/i.test(afterMatch[0]);
        const rawNum = parseInt(afterMatch[1]);
        const assumePm = !hasExplicitPm && !/am/i.test(afterMatch[0]) && rawNum >= 4;
        const suffix = hasExplicitPm ? 'pm' : (assumePm ? 'pm' : '');
        startMin = parseTimeToMin(afterMatch[1] + (afterMatch[2] ? ':' + afterMatch[2] : '') + suffix);
        endMin = null;
      } else if (adjustedText === '12') {
        startMin = 0; endMin = null;
      } else if (adjustedText === 'midnight') {
        if (startMin !== null) { endMin = 1440; } else { startMin = 0; endMin = null; }
      } else if (adjustedText?.startsWith('midnight-')) {
        const endPart = adjustedText.replace('midnight-', '');
        const endMatch = endPart.match(/^(\d{1,2})(?::(\d{2}))?\s*(am)?$/i);
        if (endMatch) {
          const endHour = parseInt(endMatch[1]);
          const suffix = endMatch[3] ? 'am' : (endHour <= 12 ? 'am' : 'pm');
          const parsedEnd = parseTimeToMin(endHour + (endMatch[2] ? ':' + endMatch[2] : '') + suffix);
          if (parsedEnd !== null) { startMin = 0; endMin = parsedEnd; type = 'late_night'; }
        }
      }
    }
  }

  if (type === 'typical' && startMin === null && endMin === null && adjustedText === 'open') {
    return { type: 'late_night', days: days.length > 0 ? days : [], excludeDays: [], startMin: 840, endMin: null };
  }
  if (startMin === null && endMin === null && type === 'typical') return null;

  return { type: type ?? 'typical', days: days.length > 0 ? days : [], excludeDays: [], startMin, endMin };
}

interface HHSchedule { windows: [HHWindow | null, HHWindow | null, HHWindow | null]; rawText: string; totalParsed: number }

function parseHHSchedule(text: string): HHSchedule {
  if (!text || !text.trim()) return { windows: [null, null, null], rawText: text, totalParsed: 0 };
  const commaClauses = text.split(',').map(c => c.trim()).filter(c => c.length > 0);
  const stored: HHWindow[] = [];
  for (const clause of commaClauses) {
    const lower = clause.toLowerCase();
    const splitMatch = lower.match(/^(.+?)\s*(?:,?\s*(?:and|&|also)\s*)+(.+)$/);
    const subClauses: string[] = [];
    if (splitMatch) {
      const orig1 = clause.slice(0, splitMatch[1].length).trim();
      const orig2 = clause.slice(clause.length - splitMatch[2].length).trim();
      if (orig1) subClauses.push(orig1);
      if (orig2) subClauses.push(orig2);
    } else {
      subClauses.push(clause);
    }
    for (const sub of subClauses) {
      const window = parseOneClause(sub);
      if (!window || !window.type) continue;
      if (window.days.length === 0) window.days = [1,2,3,4,5,6,7];
      stored.push(window);
    }
  }
  const windows: [HHWindow | null, HHWindow | null, HHWindow | null] = [null, null, null];
  for (let i = 0; i < Math.min(stored.length, 3); i++) windows[i] = stored[i];
  return { windows, rawText: text, totalParsed: stored.length };
}

// ── Test Data ────────────────────────────────────────────────────────────────

interface VenueWindow { type: string; days: string; start: number | null; end: number | null }
interface Venue {
  name: string;
  windows: [VenueWindow | null, VenueWindow | null, VenueWindow | null];
}

const venues: Venue[] = [
  {
    name: 'Paymaster Lounge',
    windows: [
      { type: 'typical',   days: '1,2,3,4,5,6,7', start: 840,   end: 1080  },
      { type: 'late_night',days: '1,2,3,4,5,6,7', start: 0,     end: null  },
      null,
    ],
  },
  {
    name: 'The Star',
    windows: [
      { type: 'all_day',   days: '1',              start: null,  end: null  },
      { type: 'typical',   days: '2,3,4,5',         start: 900,   end: 1050  },
      null,
    ],
  },
  {
    name: 'Park City Pub',
    windows: [
      { type: 'typical',   days: '1',              start: 900,   end: 1080  },
      { type: 'typical',   days: '3,4,5',           start: 900,   end: 1080  },
      { type: 'all_day',   days: '2',               start: null,  end: null  },
    ],
  },
  {
    name: 'Schilling Cider House',
    windows: [
      { type: 'typical',   days: '3,4,5',           start: 960,   end: 1080  },
      { type: 'typical',   days: '7',               start: 780,   end: 900   },
      { type: 'late_night',days: '3,4,5,6,7',      start: 1200,  end: 1260  },
    ],
  },
  {
    name: 'Fulton Pub & Brewery',
    windows: [
      { type: 'typical',   days: '1,2,3,4,5,6,7',   start: 840,   end: 1020  },
      { type: 'late_night',days: '1,2,3,4,5,6,7',   start: 1260,  end: 1380  },
      null,
    ],
  },
  {
    name: 'Bar Diane',
    windows: [
      { type: 'typical',   days: '1,2,3,4,5,6',    start: 960,   end: 1050  },
      { type: 'late_night',days: '1,2,3,4,5,6',    start: 1260,  end: 1320  },
      null,
    ],
  },
];

// ── Test Runner ───────────────────────────────────────────────────────────────

function windowsEqual(a: HHWindow | null, b: HHWindow | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const daysA = [...(a.days||[])].sort().join(',');
  const daysB = [...(b.days||[])].sort().join(',');
  return (
    a.type === b.type &&
    daysA === daysB &&
    (a.startMin ?? -9999) === (b.startMin ?? -9999) &&
    (a.endMin ?? -9999) === (b.endMin ?? -9999)
  );
}

console.log(`\n=== HH Round-Trip Test: ${venues.length} venues (2026-07-08) ===\n`);
console.log('Legend: WIN ✅ = exact match  |  PARTIAL ⚠️ = parser returned fewer windows  |  MISMATCH ❌\n');

for (const venue of venues) {
  const [w1, w2, w3] = venue.windows;
  const fw1 = formatWindow(w1?.type, w1?.days, w1?.start, w1?.end, null);
  const fw2 = formatWindow(w2?.type, w2?.days, w2?.start, w2?.end, null);
  const fw3 = formatWindow(w3?.type, w3?.days, w3?.start, w3?.end, null);
  const formatted = getHhLabel(fw1, fw2, fw3);

  const reparsed = parseHHSchedule(formatted);
  const rp = reparsed.windows;

  // Build comparison
  let allMatch = true;
  let anyPartial = false;
  const comparisons: Array<{ slot: number; status: string; orig?: VenueWindow; re?: HHWindow }> = [];

  for (let i = 0; i < 3; i++) {
    const orig = venue.windows[i];
    const re = rp[i];
    const origFilled = orig && orig.type !== undefined;
    const reFilled = re && re.type !== null;

    if (!origFilled && !reFilled) {
      comparisons.push({ slot: i, status: 'both-empty' });
    } else if (!origFilled && reFilled) {
      comparisons.push({ slot: i, status: 'parser-extra', re });
      anyPartial = true;
    } else if (origFilled && !reFilled) {
      comparisons.push({ slot: i, status: 'parser-missing', orig: orig! });
      allMatch = false;
    } else {
      const daysOrig = orig!.days.split(',').map(Number).sort();
      const daysRe = [...(re!.days||[])].sort();
      const match = (
        orig!.type === re!.type &&
        daysOrig.join(',') === daysRe.join(',') &&
        (orig!.start ?? -9999) === re!.startMin &&
        (orig!.end ?? -9999) === re!.endMin
      );
      if (!match) allMatch = false;
      comparisons.push({ slot: i, status: match ? 'match' : 'mismatch', orig: orig!, re });
    }
  }

  const overall = allMatch && !anyPartial ? 'WIN ✅' : anyPartial ? 'PARTIAL ⚠️' : 'MISMATCH ❌';

  console.log(`── ${venue.name} ──`);
  console.log(`  Formatted text : "${formatted}"`);
  console.log(`  Overall         : ${overall}`);
  for (const c of comparisons) {
    const slot = `Window ${c.slot + 1}`;
    if (c.status === 'both-empty') {
      console.log(`    ${slot}: (both empty)`);
    } else if (c.status === 'parser-extra') {
      console.log(`    ${slot}: PARSER RETURNED UNEXPECTED — type=${c.re!.type}, days=${c.re!.days}, start=${c.re!.startMin}, end=${c.re!.endMin}`);
    } else if (c.status === 'parser-missing') {
      console.log(`    ${slot}: PARSER LOST — had type=${c.orig!.type}, days=${c.orig!.days}, start=${c.orig!.start}, end=${c.orig!.end}`);
    } else if (c.status === 'match') {
      console.log(`    ${slot}: MATCH ✅`);
    } else {
      console.log(`    ${slot}: MISMATCH ❌`);
      console.log(`      Original : type=${c.orig!.type}, days=${c.orig!.days}, start=${c.orig!.start}, end=${c.orig!.end}`);
      console.log(`      Re-parsed: type=${c.re!.type}, days=${c.re!.days}, start=${c.re!.startMin}, end=${c.re!.endMin}`);
    }
  }
  console.log();
}

console.log('\n=== SUMMARY ===');
for (const venue of venues) {
  const [w1, w2, w3] = venue.windows;
  const fw1 = formatWindow(w1?.type, w1?.days, w1?.start, w1?.end, null);
  const fw2 = formatWindow(w2?.type, w2?.days, w2?.start, w2?.end, null);
  const fw3 = formatWindow(w3?.type, w3?.days, w3?.start, w3?.end, null);
  const formatted = getHhLabel(fw1, fw2, fw3);
  const reparsed = parseHHSchedule(formatted);
  const rp = reparsed.windows;

  let allMatch = true, anyPartial = false;
  for (let i = 0; i < 3; i++) {
    const orig = venue.windows[i];
    const re = rp[i];
    const origFilled = orig && orig.type !== undefined;
    const reFilled = re && re.type !== null;
    if (!origFilled && !reFilled) { /* ok */ }
    else if (!origFilled && reFilled) { anyPartial = true; }
    else if (origFilled && !reFilled) { allMatch = false; }
    else {
      const daysOrig = orig!.days.split(',').map(Number).sort();
      const daysRe = [...(re!.days||[])].sort();
      const match = orig!.type === re!.type && daysOrig.join(',') === daysRe.join(',') &&
        (orig!.start ?? -9999) === re!.startMin && (orig!.end ?? -9999) === re!.endMin;
      if (!match) allMatch = false;
    }
  }
  const overall = allMatch && !anyPartial ? 'WIN ✅' : anyPartial ? 'PARTIAL ⚠️' : 'MISMATCH ❌';
  console.log(`${overall} ${venue.name}`);
  if (overall !== 'WIN ✅') console.log(`    → "${formatted}"`);
}
