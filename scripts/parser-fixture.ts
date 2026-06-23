/**
 * Standalone fixture runner for parse-hh.ts.
 * Runs a fixed battery of inputs through parseOneClause and dumps
 * JSON-serialisable results to stdout. Used to capture before/after
 * snapshots of parser behavior across parser rulings + regressions.
 *
 * Usage:  node --experimental-strip-types scripts/parser-fixture.ts > snapshot.json
 */
import { parseOneClause } from '../src/lib/parse-hh.ts'

const FIXTURE: string[] = [
  // ── Tonight's Ruling 1 (broadened cross-midnight) ──
  '10pm-2',
  '10-2',
  '11pm-2am',
  '10pm-2pm',
  '10pm-2am',
  '4-7',
  '2-10',
  '6-4',
  '6pm-4',
  '4pm-7pm',
  '10-12',
  '10pm-12',
  '10-12am',
  '11pm-12am',
  '10:30pm-2',
  '10-2:30',
  '5-3',
  '5pm-3',
  '5-3am',
  '5pm-3am',
  // ── Tonight's Ruling 2 (after [time] with suffix) ──
  'after 9',
  'after 9pm',
  'after 9pm to close',
  'after 10',
  'after 10pm',
  'after 12',
  'after midnight',
  'after 12am',
  'after 12pm',       // expected: null (noon < 2pm floor)
  // ── Tonight's Ruling 3 (til as universal connector) ──
  'Mon til Fri',
  'Mon till Fri',
  'Mon to Fri',
  'Mon-Fri',
  '4 til 7',
  '4 till 7',
  '4 to 7',
  '4-7',
  'Mon til Fri 4 til 7',
  'Mon-Fri 4 til 7',
  'Mon til Fri 4-7pm',
  'Mon to Fri 4 to 7',
  'Tue-Sat 4 til 7pm',
  'Mon til 7pm',      // mixed day-time → "until" / open_through
  'open til 5pm',
  'til 5pm',
  'until 5pm',
  'til close',
  // ── Tonight's minor (before [am time]) ──
  'before 2am',
  'before 6pm',
  'before 5',
  'before 12',
  'before 11am',
  'before 11pm',
  // ── All-day ──
  'all day',
  'all day monday',
  'happy hour all day',
  // ── Common inputs (regression) ──
  '4-7pm',
  '4pm-7pm',
  '4pm-7',
  '4-7pm Mon',
  'Mon 4-7pm',
  'Mon-Fri 4-7pm',
  'M-F 4-7pm',
  'Wed 4-7pm',
  'W 4-7pm',
  'happy hour 4-7pm',
  '10pm to close',
  '10-close',
  '10pm-close',
  '4pm-close',
  'until close',
  'to close',
  'til close',
  '10pm-midnight',
  '10pm to midnight',
  'until midnight',
  'midnight to close',
  'after midnight to close',
  'midnight',
  // ── Days-only ranges (need a time) ──
  'Mon-Fri',
  'Mon-Fri all day',
  'weekdays all day',
  // ── Edge cases ──
  'open through 5pm',
  'open from 5pm',
  '3:30pm-5:30pm',
  'noon',
  '12pm',
  '12am',
  'noon to close',
  'midnight',
]

type Win = ReturnType<typeof parseOneClause>

function describe(w: Win): string {
  if (!w) return 'null'
  const days = w.days.join(',')
  return `${w.type} d=[${days}] ${w.startMin ?? '∅'}→${w.endMin ?? '∅'}`
}

const out = FIXTURE.map(input => {
  const w = parseOneClause(input)
  return { input, result: describe(w), structured: w }
})
console.log(JSON.stringify(out, null, 2))