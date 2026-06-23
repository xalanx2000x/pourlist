/**
 * Parser Truth Table — Final (2026-06-21)
 *
 * Measures parseOneClause + parseHHSchedule against the authoritative spec.
 * This is READ-ONLY measurement — no parser logic is changed.
 *
 * Usage: node --experimental-strip-types scripts/parser-truth-table.ts
 *
 * Exit code: 0 if all PASS, 1 if any FAIL.
 */
import { parseOneClause, parseHHSchedule } from '../src/lib/parse-hh.ts'
import { getCityCloseMin, getStateCloseMin } from '../src/lib/bar-close-times.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Win = ReturnType<typeof parseOneClause>

function fmtWinBrief(w: Win | null): string {
  if (!w) return 'null'
  return `${w.type} ${w.startMin ?? '∅'}→${w.endMin ?? '∅'} [${w.days.join(',')}]`
}

// ─── Test case types ──────────────────────────────────────────────────────────

type ExpectedWindow = {
  type?: string | null
  startMin?: number | null
  endMin?: number | null
  days?: number[]
  note?: string
}

type TestCase = {
  input: string
  expected: ExpectedWindow | ExpectedWindow[] | string | null
  mode: 'single' | 'multi' | 'lookup-city' | 'lookup-state'
  expectedFail?: boolean
  note?: string
}

// ─── Truth table ──────────────────────────────────────────────────────────────

const CASES: TestCase[] = [
  // ── Standard ranges ──────────────────────────────────────────────────────
  { input: '4-7pm',             mode: 'single', expected: { type: 'typical', startMin: 960,  endMin: 1140, days: [] } },
  { input: '4-6',               mode: 'single', expected: { type: 'typical', startMin: 960,  endMin: 1080, days: [] } },
  { input: '3pm-6pm',           mode: 'single', expected: { type: 'typical', startMin: 900,  endMin: 1080, days: [] } },
  { input: '4:30-6:30',         mode: 'single', expected: { type: 'typical', startMin: 990,  endMin: 1110, days: [] } },
  { input: '4:30pm-7',          mode: 'single', expected: { type: 'typical', startMin: 990,  endMin: 1140, days: [] } },
  { input: '2-5',               mode: 'single', expected: { type: 'typical', startMin: 840,  endMin: 1020, days: [] } },
  { input: '2-10',              mode: 'single', expected: { type: 'typical', startMin: 840,  endMin: 1320, days: [] } },

  // ── Days ─────────────────────────────────────────────────────────────────
  { input: 'Mon-Fri 4-7pm',    mode: 'single', expected: { type: 'typical', startMin: 960,  endMin: 1140, days: [1,2,3,4,5] } },
  { input: 'M-F 3-6',           mode: 'single', expected: { type: 'typical', startMin: 900,  endMin: 1080, days: [1,2,3,4,5] } },
  { input: 'Sat 5-8pm',         mode: 'single', expected: { type: 'typical', startMin: 1020, endMin: 1200, days: [6] } },
  { input: 'weekdays 3-6pm',   mode: 'single', expected: { type: 'typical', startMin: 900,  endMin: 1080, days: [1,2,3,4,5] } },
  { input: 'weekends 2-5',     mode: 'single', expected: { type: 'typical', startMin: 840,  endMin: 1020, days: [6,7] } },
  { input: 'daily 4-6',        mode: 'single', expected: { type: 'typical', startMin: 960,  endMin: 1080, days: [1,2,3,4,5,6,7] } },
  { input: 'Wed-Sun 4-6',      mode: 'single', expected: { type: 'typical', startMin: 960,  endMin: 1080, days: [3,4,5,6,7] } },
  { input: 'Fri-Mon 4-6',      mode: 'single', expected: { type: 'typical', startMin: 960,  endMin: 1080, days: [5,6,7,1] } },
  { input: 'Mon-Fri',          mode: 'single', expected: null },

  // ── til/to connectors ────────────────────────────────────────────────────
  { input: 'Mon til Fri 4-7pm',   mode: 'single', expected: { type: 'typical', startMin: 960,  endMin: 1140, days: [1,2,3,4,5] } },
  { input: 'Mon to Fri 4-7pm',   mode: 'single', expected: { type: 'typical', startMin: 960,  endMin: 1140, days: [1,2,3,4,5] } },
  { input: '4 til 7',            mode: 'single', expected: { type: 'typical', startMin: 960,  endMin: 1140, days: [] } },
  { input: '4 to 7',            mode: 'single', expected: { type: 'typical', startMin: 960,  endMin: 1140, days: [] } },
  { input: 'Mon til Fri 4 til 7', mode: 'single', expected: { type: 'typical', startMin: 960,  endMin: 1140, days: [1,2,3,4,5] } },
  { input: 'open til 5pm',       mode: 'single', expected: { type: 'open_through', startMin: 840, endMin: 1020, days: [] } },
  { input: 'til 5pm',           mode: 'single', expected: { type: 'open_through', startMin: 840, endMin: 1020, days: [] } },

  // ── All-day ──────────────────────────────────────────────────────────────
  { input: 'all day',           mode: 'single', expected: { type: 'all_day', startMin: null, endMin: null, days: [] } },
  { input: 'all day Sunday',   mode: 'single', expected: { type: 'all_day', startMin: null, endMin: null, days: [7] } },
  { input: 'Monday all day',   mode: 'single', expected: { type: 'all_day', startMin: null, endMin: null, days: [1] } },
  {
    input: 'all day Mon-Fri',
    mode: 'single',
    expected: { type: 'all_day', startMin: null, endMin: null, days: [1,2,3,4,5] },
    expectedFail: true,
    note: 'parser returns all_day with days=[1] (Mon only); "Mon-Fri" after "all day" is dropped',
  },

  // ── Open-through ─────────────────────────────────────────────────────────
  {
    input: 'open until 6pm',
    mode: 'single',
    expected: { type: 'open_through', startMin: 840, endMin: 1080, days: [] },
    expectedFail: true,
    note: 'parser returns start=null (open), not 840 (2pm) — "open" in "open until" is interpreted as "venue open" not "2pm default HH start"',
  },
  { input: 'until 6',          mode: 'single', expected: { type: 'open_through', startMin: 840, endMin: 1080, days: [] } },
  { input: 'before 5',         mode: 'single', expected: { type: 'open_through', startMin: 840, endMin: 1020, days: [] } },
  { input: 'before 6pm',       mode: 'single', expected: { type: 'open_through', startMin: 840, endMin: 1080, days: [] } },
  {
    input: 'thru 6pm',
    mode: 'single',
    expected: { type: 'open_through', startMin: 840, endMin: 1080, days: [] },
    expectedFail: true,
    note: '"thru" is not a recognized keyword — returns null',
  },
  { input: 'until 5pm',        mode: 'single', expected: { type: 'open_through', startMin: 840, endMin: 1020, days: [] } },

  // ── Late-night / close ───────────────────────────────────────────────────
  { input: '10pm-close',       mode: 'single', expected: { type: 'late_night', startMin: 1320, endMin: null, days: [] } },
  { input: '10-close',         mode: 'single', expected: { type: 'late_night', startMin: 1320, endMin: null, days: [] } },
  { input: '9pm to close',      mode: 'single', expected: { type: 'late_night', startMin: 1260, endMin: null, days: [] } },
  { input: '2-close',           mode: 'single', expected: { type: 'late_night', startMin: 840,  endMin: null, days: [] } },
  { input: 'after 9pm',         mode: 'single', expected: { type: 'late_night', startMin: 1260, endMin: null, days: [] } },
  { input: 'after 10pm',        mode: 'single', expected: { type: 'late_night', startMin: 1320, endMin: null, days: [] } },
  {
    input: 'after 9',
    mode: 'single',
    expected: { type: 'late_night', startMin: 1260, endMin: null, days: [] },
    expectedFail: true,
    note: 'spec says 1260 (after 9pm = 9 PM), but bare "after 9" strips to midnight (1440) — spec may need revision since "after 9" is ambiguous without pm',
  },

  // ── Midnight (=1440) ─────────────────────────────────────────────────────
  { input: '10pm-midnight',       mode: 'single', expected: { type: 'typical', startMin: 1320, endMin: 1440, days: [] } },
  {
    input: '9pm-12am',
    mode: 'single',
    expected: { type: 'typical', startMin: 1260, endMin: 1440, days: [] },
    expectedFail: true,
    note: 'parser returns type=late_night (cross-midnight rule applies); spec says typical — both have explicit suffix, so same start+end, only type differs',
  },
  { input: '10pm to midnight',    mode: 'single', expected: { type: 'typical', startMin: 1320, endMin: 1440, days: [] } },
  {
    input: 'until midnight',
    mode: 'single',
    expected: { type: 'open_through', startMin: 840, endMin: 1440, days: [] },
    expectedFail: true,
    note: 'parser returns start=null (open), not 840 (2pm) — same "open" issue as "open until 6pm"',
  },
  { input: 'midnight to close',    mode: 'single', expected: { type: 'late_night', startMin: 1440, endMin: null, days: [] } },
  { input: 'after midnight',      mode: 'single', expected: { type: 'late_night', startMin: 1440, endMin: null, days: [] } },
  { input: 'after 12',            mode: 'single', expected: { type: 'late_night', startMin: 1440, endMin: null, days: [] } },
  {
    input: 'after 12am',
    mode: 'single',
    expected: { type: 'late_night', startMin: 1440, endMin: null, days: [] },
    expectedFail: true,
    note: 'known-open: returns startMin=0 (old sentinel) instead of 1440 — storage only, not user-visible',
  },
  {
    input: 'after 12pm',
    mode: 'single',
    expected: null,
    expectedFail: true,
    note: 'known-open: returns startMin=720 (noon-close) instead of null — near-nonexistent input',
  },

  // ── Cross-midnight ──────────────────────────────────────────────────────
  { input: '10pm-2am',        mode: 'single', expected: { type: 'late_night', startMin: 1320, endMin: 120, days: [] } },
  { input: '10-2',            mode: 'single', expected: { type: 'late_night', startMin: 1320, endMin: 120, days: [] } },
  { input: '6-4',             mode: 'single', expected: { type: 'late_night', startMin: 1080, endMin: 240, days: [] } },
  { input: '10pm-2',          mode: 'single', expected: { type: 'late_night', startMin: 1320, endMin: 120, days: [] } },
  { input: '11pm-1am',        mode: 'single', expected: { type: 'late_night', startMin: 1380, endMin: 60,  days: [] } },
  { input: '10:30pm-2',       mode: 'single', expected: { type: 'late_night', startMin: 1350, endMin: 120, days: [] } },
  { input: '11pm-2am',        mode: 'single', expected: { type: 'late_night', startMin: 1380, endMin: 120, days: [] } },

  // ── before [am] ─────────────────────────────────────────────────────────
  { input: 'before 2am',      mode: 'single', expected: { type: 'open_through', startMin: 840, endMin: 120, days: [] } },

  // ── Multi-window ────────────────────────────────────────────────────────
  {
    input: '4-6pm and 9-close',
    mode: 'multi',
    expected: [
      { type: 'typical',    startMin: 960,  endMin: 1080, days: [] },
      { type: 'late_night', startMin: 1260, endMin: null,  days: [] },
    ],
    expectedFail: true,
    note: 'parser returns 3 windows: [late_night 1260→∅ [all]], [null], [null] — day-all overrides first window; "and" separator not splitting into two windows',
  },
  {
    input: 'Mon-Fri 3-6, Sat 5-8',
    mode: 'multi',
    expected: [
      { type: 'typical', startMin: 900,  endMin: 1080, days: [1,2,3,4,5] },
      { type: 'typical', startMin: 1020, endMin: 1200, days: [6] },
    ],
  },
  {
    input: '3-6 and 10-midnight',
    mode: 'multi',
    expected: [
      { type: 'typical', startMin: 900,  endMin: 1080, days: [] },
      { type: 'typical', startMin: 1320, endMin: 1440, days: [] },
    ],
    expectedFail: true,
    note: 'parser returns only [typical 1320→1440 [all]] — first window "3-6" is absorbed into the late-night day-all rule, "and" not recognized as separator',
  },
  {
    input: 'Mon 3-6 and 9-close, Tue 4-7',
    mode: 'multi',
    expected: [
      { type: 'typical',    startMin: 900,  endMin: 1080, days: [1] },
      { type: 'late_night', startMin: 1260, endMin: null, days: [1] },
      { type: 'typical',    startMin: 960,  endMin: 1140, days: [2] },
    ],
    expectedFail: true,
    note: 'parser returns [typical 960→1140 [2]], [late_night 1260→∅ [1]], [late_night 1260→∅ [all]] — Mon day association wrong; 3 windows total',
  },
  {
    input: 'Mon 3-6, Tue 4-7, Wed 5-8, Thu 6-9',
    mode: 'multi',
    expected: 'overflow',
    note: 'overflow detection — spec says totalParsed=4, 3 captured. parser totalParsed = ?',
  },

  // ── Overlap split ────────────────────────────────────────────────────────
  {
    input: 'M-F 4-6, Wed 3-5',
    mode: 'multi',
    expected: [
      { type: 'typical', startMin: 960, endMin: 1080, days: [1,2,4,5] },
      { type: 'typical', startMin: 900, endMin: 1020, days: [3] },
    ],
    expectedFail: true,
    note: 'parser returns [900→1020 [3]], [960→1080 [1,2]], [960→1080 [4,5]] — Wed is being split as its own window but days=3 only, not combined correctly',
  },
  {
    input: 'weekdays 3-6, Friday 4-8',
    mode: 'multi',
    expected: [
      { type: 'typical', startMin: 900,  endMin: 1080, days: [1,2,3,4] },
      { type: 'typical', startMin: 960, endMin: 1200, days: [5] },
    ],
    expectedFail: true,
    note: 'parser returns [960→1200 [5]], [900→1080 [1,2,3,4]], [null] — Fri is first window, weekdays second; order is reversed but content is correct',
  },

  // ── Garbage / incomplete → null ─────────────────────────────────────────
  { input: '',                 mode: 'single', expected: null },
  { input: '!!!',             mode: 'single', expected: null },
  { input: 'happy hour',      mode: 'single', expected: null },
  { input: 'asdf',           mode: 'single', expected: null },
  { input: 'tba',             mode: 'single', expected: null },
  { input: '4-null-6pm',     mode: 'single', expected: null },
  { input: '1000000-2',      mode: 'single', expected: null },
  { input: 'pm',             mode: 'single', expected: null },
  {
    input: '4-4',
    mode: 'single',
    expected: null,
    expectedFail: true,
    note: 'zero-length range returns typical 960→960 instead of null',
  },
  {
    input: 'before 12',
    mode: 'single',
    expected: { type: 'open_through', startMin: 840, endMin: 1440, days: [] },
  },

  // ── Close-time lookups ───────────────────────────────────────────────────
  // Nominatim state-code fix (#2 above) is exercised by the geocoder path
  // (parseNominatimResult in gps.ts) and cannot be truth-table tested here
  // since getCityCloseMin/getStateCloseMin take city+state, not raw Nominatim
  // output. Verified manually; guard is regression-stable.
  { input: "getCityCloseMin('Portland','OR')",  mode: 'lookup-city', expected: 150 },
  { input: "getCityCloseMin('New York','NY')",   mode: 'lookup-city', expected: 240 },
  {
    input: "getCityCloseMin('New Orleans','LA')",
    mode: 'lookup-city',
    expected: 240,
  },
  {
    input: "getCityCloseMin('Las Vegas','NV')",
    mode: 'lookup-city',
    expected: 240,
  },
  { input: "getStateCloseMin('CA')",             mode: 'lookup-state', expected: 120 },
  { input: "getCityCloseMin('Nowheresville','OR')", mode: 'lookup-city', expected: 150 },
  { input: "getStateCloseMin('XX')",              mode: 'lookup-state', expected: 120 },
  { input: "getStateCloseMin('LA')",              mode: 'lookup-state', expected: 240 },
  // ── City alias normalization (item #3) ────────────────────────────────────
  // normalizeCityForLookup reconciles geocoder output to table keys:
  //   "Honolulu" → "Urban Honolulu"  (strip "Urban " prefix)
  //   "St. Louis" → "Saint Louis"   (abbrev → expanded)
  //   "Ft. Worth" → "Fort Worth"     (abbrev → expanded)
  { input: "getCityCloseMin('Honolulu','HI')",     mode: 'lookup-city', expected: 240 },
  { input: "getCityCloseMin('St. Louis','MO')",    mode: 'lookup-city', expected: 90 },
  { input: "getCityCloseMin('Ft. Worth','TX')",    mode: 'lookup-city', expected: 120 },
]

// ─── Runner ───────────────────────────────────────────────────────────────────

function compareWindow(actual: Win, expected: ExpectedWindow): boolean {
  if (actual.type !== expected.type) return false
  if (actual.startMin !== expected.startMin) return false
  if (actual.endMin !== expected.endMin) return false
  const actualDays = [...(actual.days ?? [])].sort()
  const expectedDays = [...(expected.days ?? [])].sort()
  if (actualDays.join(',') !== expectedDays.join(',')) return false
  return true
}

let pass = 0, fail = 0, xpass = 0, xfail = 0

console.log('╔══════════════════════════════════════════════════════════════════════════════╗')
console.log('║          PARSER TRUTH TABLE — 2026-06-21                                   ║')
console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n')

for (const tc of CASES) {
  let actual: unknown
  let ok = false

  if (tc.mode === 'single') {
    const w = parseOneClause(tc.input)
    actual = w
    if (tc.expected === null) {
      ok = w === null
    } else if (w === null) {
      ok = false
    } else {
      ok = compareWindow(w, tc.expected as ExpectedWindow)
    }
  } else if (tc.mode === 'multi') {
    const result = parseHHSchedule(tc.input)
    actual = result.windows.map(w => w ? fmtWinBrief(w) : 'null')
    if (tc.expected === 'overflow') {
      ok = result.totalParsed > 3
    } else {
      const expected = tc.expected as ExpectedWindow[]
      const actualWins = result.windows.filter(Boolean) as Win[]
      if (actualWins.length !== expected.length) {
        ok = false
      } else {
        ok = actualWins.every((w, i) => compareWindow(w, expected[i]))
      }
    }
  } else if (tc.mode === 'lookup-city') {
    const match = tc.input.match(/'([^']+)','([^']+)'/)
    if (!match) { ok = false }
    else {
      const [, city, state] = match
      actual = getCityCloseMin(city, state)
      ok = actual === tc.expected
    }
  } else if (tc.mode === 'lookup-state') {
    const m = tc.input.match(/\('([^']+)'\)/)
    if (!m) { ok = false }
    else {
      actual = getStateCloseMin(m[1])
      ok = actual === tc.expected
    }
  }

  const status = ok
    ? (tc.expectedFail ? '✅  KNOWN' : '✅  PASS')
    : (tc.expectedFail ? '❌ UNEXP' : '❌  FAIL')

  if (ok) {
    if (tc.expectedFail) xpass++
    else pass++
  } else {
    if (tc.expectedFail) xfail++
    else fail++
  }

  console.log(`${status}  ${tc.input}`)
  if (!ok) {
    const expStr = JSON.stringify(tc.expected)
    const actStr = tc.mode === 'multi'
      ? JSON.stringify(actual)
      : (actual as Win | null) === null ? 'null' : fmtWinBrief(actual as Win)
    console.log(`       expected → ${expStr}`)
    console.log(`       actual   → ${actStr}`)
  }
  if (tc.note && !ok) {
    console.log(`       note     → ${tc.note}`)
  } else if (tc.note && tc.expectedFail && ok) {
    console.log(`       note     → ${tc.note}`)
  }
}

console.log('\n────────────────────────────────────────')
console.log('  PASS : ' + pass + '  |  FAIL: ' + fail)
if (xpass > 0 || xfail > 0) {
  console.log('  KNOWN : ' + xpass + '  |  UNEXP: ' + xfail + '  (known-bug confirmations / unexpected failures)')
}
console.log('────────────────────────────────────────')
process.exit(fail > 0 ? 1 : 0)
