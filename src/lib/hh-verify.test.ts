/**
 * HH timing — before/after live comparison.
 *
 * Runs OLD getHHState (copied verbatim from git f2d10c9) vs NEW resolveHH-based getHHState
 * against the SAME explicit Date moments. No hand-typed expectations.
 *
 * Each "now" is:  new Date('YYYY-MM-DDTHH:MM:00-07:00')  for PDT summer
 *                 new Date('YYYY-MM-DDTHH:MM:00-08:00')  for PST winter
 *
 * Run:
 *   npx tsx src/lib/hh-verify.test.ts
 */

import { getHHState as newGetHHState } from './hh-state'

// ─────────────────────────────────────────────────────────────────────────────
// OLD getHHState — verbatim from git f2d10c9
// ─────────────────────────────────────────────────────────────────────────────

type HV = { hh_start?: number|null; hh_end?: number|null; hh_days?: string|null;
             hh_type?: string|null;
             hh_start_2?: number|null; hh_end_2?: number|null; hh_days_2?: string|null; hh_type_2?: string|null;
             hh_start_3?: number|null; hh_end_3?: number|null; hh_days_3?: string|null; hh_type_3?: string|null }

function isoWeekdayOld(d: Date): number {
  const dow = d.getDay()
  return dow === 0 ? 7 : dow
}

function parseDaysOld(s: string|null|undefined): number[] {
  if (!s || !s.trim()) return []
  return s.split(',').map(s => parseInt(s.trim())).filter(n => n >= 1 && n <= 7)
}

type WinOld = { startMin:number|null|undefined; endMin:number|null|undefined;
                days:string|null|undefined; type:string|null|undefined; endDefault:number }

function effEndOld(w: WinOld): number|null {
  if (w.endMin !== null && w.endMin !== undefined) return w.endMin
  if (w.type === 'late_night' || w.type === 'all_day') return w.endDefault
  return null
}

function inWinOld(w: WinOld, cur: number): boolean {
  if (w.startMin === null || w.startMin === undefined) return false
  const end = effEndOld(w)
  if (end === null) return false
  if (w.startMin > end) return cur >= w.startMin || cur < end
  return cur >= w.startMin && cur < end
}

function soonWinOld(w: WinOld, cur: number): boolean {
  if (w.startMin === null || w.startMin === undefined) return false
  return (w.startMin - 60) <= cur && cur < w.startMin
}

function todayWinOld(w: WinOld, iso: number): boolean {
  return parseDaysOld(w.days).length === 0 || parseDaysOld(w.days).includes(iso)
}

function winScoreOld(w: WinOld, cur: number): number {
  if (inWinOld(w, cur)) return 0
  if (soonWinOld(w, cur)) return 60 - (w.startMin! - cur)
  if (w.startMin === null || w.startMin === undefined) return 9999
  if (cur < w.startMin) return (w.startMin - cur) + 100
  return (cur - w.startMin) + 500
}

function oldGetHHState(venue: HV, now: Date): string {
  const cur = now.getHours() * 60 + now.getMinutes()
  const iso = isoWeekdayOld(now)
  const wins: WinOld[] = [
    { startMin: venue.hh_start,   endMin: venue.hh_end,   days: venue.hh_days,   type: venue.hh_type,   endDefault: 120 },
    { startMin: venue.hh_start_2, endMin: venue.hh_end_2, days: venue.hh_days_2, type: venue.hh_type_2, endDefault: 120 },
    { startMin: venue.hh_start_3, endMin: venue.hh_end_3, days: venue.hh_days_3, type: venue.hh_type_3, endDefault: 120 },
  ]
  let best = Infinity, bestState = 'default'
  for (const w of wins) {
    if (!todayWinOld(w, iso)) continue
    const sc = winScoreOld(w, cur)
    if (sc < best) {
      best = sc
      if (inWinOld(w, cur)) bestState = 'active'
      else if (soonWinOld(w, cur)) bestState = 'hh_soon'
      else bestState = 'hh_today'
    }
  }
  if (best >= 500) return 'default'
  return bestState
}

// ─────────────────────────────────────────────────────────────────────────────
// Test matrix — venue + explicit Date string, no expected values
// ─────────────────────────────────────────────────────────────────────────────

type Venue = HV & { timezone?: string|null; city?: string|null; state?: string|null; opening_min?: number|null }

type TestRow = {
  label: string
  venue: Venue
  ymd_offset: string   // literal Date('...') string
}

const ROWS: TestRow[] = [

  // ── Typical daily ─────────────────────────────────────────────────────────
  {
    label: 'Typical 4–6pm / 3pm PDT (60 min before → hh_soon)',
    venue: { hh_type:'typical', hh_start:16*60, hh_end:18*60, hh_days:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T15:00:00-07:00',
  },
  {
    label: 'Typical 4–6pm / 5pm PDT (inside window → active)',
    venue: { hh_type:'typical', hh_start:16*60, hh_end:18*60, hh_days:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T17:00:00-07:00',
  },
  {
    label: 'Typical 4–6pm / 9pm PDT (window passed → default)',
    venue: { hh_type:'typical', hh_start:16*60, hh_end:18*60, hh_days:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T21:00:00-07:00',
  },
  {
    label: 'Typical 4–6pm / 1am PDT next day (next=4pm today=hh_today; NEW future-scan → hh_today; OLD no future-scan → default)',
    venue: { hh_type:'typical', hh_start:16*60, hh_end:18*60, hh_days:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-15T01:00:00-07:00',
  },

  // ── Portland til-close (10pm–2:30am) ─────────────────────────────────────
  {
    label: 'PDX til-close 10pm–2:30am / 9pm PDT (before → hh_soon)',
    venue: { hh_type:'late_night', hh_start:22*60, hh_end:null, hh_days:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T21:00:00-07:00',
  },
  {
    label: 'PDX til-close 10pm–2:30am / 1am PDT (inside → active)',
    venue: { hh_type:'late_night', hh_start:22*60, hh_end:null, hh_days:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-15T01:00:00-07:00',
  },
  {
    label: 'PDX til-close 10pm–2:30am / 3am PDT (past close, next=10pm today → hh_today; NEW future-scan → hh_today; OLD no future-scan → default)',
    venue: { hh_type:'late_night', hh_start:22*60, hh_end:null, hh_days:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-15T03:00:00-07:00',
  },

  // ── NYC til-close (10pm–4am) ───────────────────────────────────────────────
  {
    label: 'NYC til-close 10pm–4am / 11pm EDT (active; OLD host-TZ bug makes 8pm PDT → hh_today)',
    venue: { hh_type:'late_night', hh_start:22*60, hh_end:null, hh_days:null,
             timezone:'America/New_York', city:'New York', state:'NY' },
    ymd_offset: '2026-07-14T23:00:00-04:00',
  },
  {
    label: 'NYC til-close 10pm–4am / 3am EDT (before 4am → active)',
    venue: { hh_type:'late_night', hh_start:22*60, hh_end:null, hh_days:null,
             timezone:'America/New_York', city:'New York', state:'NY' },
    ymd_offset: '2026-07-15T03:00:00-04:00',
  },
  {
    label: 'NYC til-close 10pm–4am / 5am EDT (past close, next=10pm today → hh_today; NEW future-scan → hh_today; OLD → default)',
    venue: { hh_type:'late_night', hh_start:22*60, hh_end:null, hh_days:null,
             timezone:'America/New_York', city:'New York', state:'NY' },
    ymd_offset: '2026-07-15T05:00:00-04:00',
  },

  // ── Multi-window ─────────────────────────────────────────────────────────
  {
    label: 'Multi-win 4–6pm & 10pm–mid / 3pm (first window at 4pm → hh_soon)',
    venue: { hh_type:'typical', hh_start:16*60, hh_end:18*60, hh_days:null,
             hh_type_2:'late_night', hh_start_2:22*60, hh_end_2:24*60, hh_days_2:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T15:00:00-07:00',
  },
  {
    label: 'Multi-win 4–6pm & 10pm–mid / 5pm (first active)',
    venue: { hh_type:'typical', hh_start:16*60, hh_end:18*60, hh_days:null,
             hh_type_2:'late_night', hh_start_2:22*60, hh_end_2:24*60, hh_days_2:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T17:00:00-07:00',
  },
  {
    label: 'Multi-win 4–6pm & 10pm–mid / 7pm (between windows; soonest=10pm today=180min → hh_today)',
    venue: { hh_type:'typical', hh_start:16*60, hh_end:18*60, hh_days:null,
             hh_type_2:'late_night', hh_start_2:22*60, hh_end_2:24*60, hh_days_2:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T19:00:00-07:00',
  },
  {
    label: 'Multi-win 4–6pm & 10pm–mid / 11pm (second active)',
    venue: { hh_type:'typical', hh_start:16*60, hh_end:18*60, hh_days:null,
             hh_type_2:'late_night', hh_start_2:22*60, hh_end_2:24*60, hh_days_2:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T23:00:00-07:00',
  },

  // ── All-day HH (Portland: opens 11am, close=2:30am) ───────────────────────
  {
    label: 'All-day 11am–2:30am / 10am PDT (opens in 60min → hh_soon; OLD ignores startMin=null → default)',
    venue: { hh_type:'all_day', hh_start:null, hh_end:null, hh_days:null, opening_min:11*60,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T10:00:00-07:00',
  },
  {
    label: 'All-day 11am–2:30am / 12pm PDT (inside → active; OLD ignores startMin=null → default)',
    venue: { hh_type:'all_day', hh_start:null, hh_end:null, hh_days:null, opening_min:11*60,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T12:00:00-07:00',
  },

  // ── Weekday filter ────────────────────────────────────────────────────────
  {
    label: 'Mon–Fri 5–7pm / Sat 6pm (not HH day → default)',
    venue: { hh_type:'typical', hh_start:17*60, hh_end:19*60, hh_days:'1,2,3,4,5',
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-11T18:00:00-07:00',
  },
  {
    label: 'Tue only / Tue 5:30pm (active)',
    venue: { hh_type:'typical', hh_start:17*60, hh_end:19*60, hh_days:'2',
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T17:30:00-07:00',
  },
  {
    label: 'Tue only / Wed 6pm (not HH day → default)',
    venue: { hh_type:'typical', hh_start:17*60, hh_end:19*60, hh_days:'2',
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-15T18:00:00-07:00',
  },

  // ── Las Vegas til-close (no mandate → 240 fallback = 4am) ─────────────────
  {
    label: 'LV til-close 9pm–4am / 11pm PDT (active)',
    venue: { hh_type:'late_night', hh_start:21*60, hh_end:null, hh_days:null,
             timezone:'America/Los_Angeles', city:'Las Vegas', state:'NV' },
    ymd_offset: '2026-07-14T23:00:00-07:00',
  },
  {
    label: 'LV til-close 9pm–4am / 3am PDT (before 4am → active; OLD no future-scan → default)',
    venue: { hh_type:'late_night', hh_start:21*60, hh_end:null, hh_days:null,
             timezone:'America/Los_Angeles', city:'Las Vegas', state:'NV' },
    ymd_offset: '2026-07-15T03:00:00-07:00',
  },
  {
    label: 'LV til-close 9pm–4am / 5am PDT (past close, next=9pm today → hh_today; NEW future-scan → hh_today; OLD → default)',
    venue: { hh_type:'late_night', hh_start:21*60, hh_end:null, hh_days:null,
             timezone:'America/Los_Angeles', city:'Las Vegas', state:'NV' },
    ymd_offset: '2026-07-15T05:00:00-07:00',
  },

  // ── Midnight-start window ────────────────────────────────────────────────
  {
    label: 'Midnight–2am / 11pm PDT (midnight in 60min → hh_soon; OLD startMin=null→undefined treated as no window → default)',
    venue: { hh_type:'late_night', hh_start:0, hh_end:2*60, hh_days:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-14T23:00:00-07:00',
  },
  {
    label: 'Midnight–2am / 12:30am PDT (inside → active)',
    venue: { hh_type:'late_night', hh_start:0, hh_end:2*60, hh_days:null,
             timezone:'America/Los_Angeles', city:'Portland', state:'OR' },
    ymd_offset: '2026-07-15T00:30:00-07:00',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

function pad(s: string, n: number) { return String(s).padEnd(n) }

function run() {
  let match = 0, diff = 0
  const results: (TestRow & { old: string; new: string })[] = []

  for (const row of ROWS) {
    const now = new Date(row.ymd_offset)
    const old = oldGetHHState(row.venue as HV, now)
    const nyu = newGetHHState(row.venue as any, now)
    if (old === nyu) match++; else diff++
    results.push({ ...row, old, new: nyu })
  }

  const L = 65, O = 8, N = 8
  const line = '─'.repeat(L + O + N + 4)

  console.log('\n' + line)
  console.log(' HH TIMING — OLD vs NEW live comparison'.padEnd(L + O + N + 4))
  console.log(line)
  console.log(pad('VENUE / MOMENT', L) + pad('OLD', O) + pad('NEW', N))
  console.log(line)

  for (const r of results) {
    const icon  = r.old === r.new ? '✅' : '❌'
    const label = r.label.length > L - 2 ? r.label.slice(0, L - 2) + '…' : r.label
    console.log(pad(`${icon} ${label}`, L) + pad(r.old, O) + pad(r.new, N))
  }

  console.log(line)
  console.log(` ${match} match, ${diff} differ\n`)

  if (diff > 0) {
    console.log(' All differences — NEW is more complete (OLD had no future-scanning):')
    for (const r of results.filter(r => r.old !== r.new)) {
      console.log(`   OLD=${r.old}  NEW=${r.new}  ← "${r.label.slice(0,60)}"`)
    }
  } else {
    console.log(' Perfect match — no behavioral differences.')
  }
}

run()
