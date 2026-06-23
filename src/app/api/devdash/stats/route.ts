/**
 * GET /api/devdash/stats
 * Returns aggregated stats for the dev dashboard.
 * Uses Supabase service role key to bypass RLS.
 * Revalidated every 5 minutes via ISR revalidate tag.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { hasActiveHappyHour } from '@/lib/activeHH'
import type { Venue } from '@/lib/supabase'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const revalidate = 300

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function todayStart(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function weekStart(): string {
  return daysAgo(7)
}

async function getFunnelStats() {
  const sevenDaysAgo = daysAgo(7)

  const [startsRes, completesRes, abandonsRes, durationRes, editedRes] = await Promise.all([
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('event_name', 'scan_start')
      .gte('created_at', sevenDaysAgo),
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('event_name', 'scan_complete')
      .gte('created_at', sevenDaysAgo),
    supabase
      .from('events')
      .select('id', { count: 'exact', head: true })
      .eq('event_name', 'scan_abandon')
      .gte('created_at', sevenDaysAgo),
    supabase
      .from('events')
      .select('metadata')
      .eq('event_name', 'scan_complete')
      .gte('created_at', sevenDaysAgo)
      .limit(500),
    supabase
      .from('events')
      .select('metadata')
      .eq('event_name', 'scan_complete')
      .gte('created_at', sevenDaysAgo)
      .limit(500),
  ])

  const startsLast7d = startsRes.count ?? 0
  const completionsLast7d = completesRes.count ?? 0
  const abandonsLast7d = abandonsRes.count ?? 0
  const completionRate = startsLast7d > 0 ? completionsLast7d / startsLast7d : 0

  // avg durationSec from metadata
  let avgDurationSec = 0
  const durations: number[] = []
  ;(durationRes.data ?? []).forEach((row: { metadata?: { durationSec?: number } }) => {
    if (row.metadata?.durationSec) durations.push(row.metadata.durationSec)
  })
  if (durations.length > 0) avgDurationSec = durations.reduce((a, b) => a + b, 0) / durations.length

  // hhWasEdited rate
  let editedCount = 0
  ;(editedRes.data ?? []).forEach((row: { metadata?: { hhWasEdited?: boolean } }) => {
    if (row.metadata?.hhWasEdited === true) editedCount++
  })
  const hhEditedRate = completionsLast7d > 0 ? editedCount / completionsLast7d : 0

  return { startsLast7d, completionsLast7d, abandonsLast7d, completionRate, avgDurationSec, hhEditedRate }
}

async function getVolumeStats() {
  const today = todayStart()
  const week = weekStart()

  const [
    scansTodayRes,
    scansWeekRes,
    completionsTodayRes,
    newVenuesTodayRes,
    photosTodayRes,
    devicesTodayRes,
    devicesWeekRes,
  ] = await Promise.all([
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('event_name', 'scan_start').gte('created_at', today),
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('event_name', 'scan_start').gte('created_at', week),
    supabase.from('events').select('id', { count: 'exact', head: true }).eq('event_name', 'scan_complete').gte('created_at', today),
    supabase.from('venues').select('id', { count: 'exact', head: true }).gte('created_at', today),
    supabase.from('photos').select('id', { count: 'exact', head: true }).gte('created_at', today),
    supabase.from('events').select('device_hash', { count: 'exact', head: true }).eq('event_name', 'scan_start').gte('created_at', today),
    supabase.from('events').select('device_hash', { count: 'exact', head: true }).eq('event_name', 'scan_start').gte('created_at', week),
  ])

  return {
    scansToday: scansTodayRes.count ?? 0,
    scansThisWeek: scansWeekRes.count ?? 0,
    completionsToday: completionsTodayRes.count ?? 0,
    newVenuesToday: newVenuesTodayRes.count ?? 0,
    photosToday: photosTodayRes.count ?? 0,
    uniqueDevicesToday: devicesTodayRes.count ?? 0,
    uniqueDevicesThisWeek: devicesWeekRes.count ?? 0,
  }
}

async function getCoverageStats() {
  // Only count user-created venues (status != 'unverified'), not the OSM seed
  const totalRes = await supabase.from('venues').select('id', { count: 'exact', head: true }).neq('status', 'unverified')
  const withHhRes = await supabase.from('venues').select('id', { count: 'exact', head: true }).neq('status', 'unverified').not('hh_type', 'is', null)
  const confirmedRes = await supabase
    .from('venues')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'verified')
    .not('hh_type', 'is', null)

  const totalVenues = totalRes.count ?? 0
  const withHhData = withHhRes.count ?? 0
  const withHhConfirmation = confirmedRes.count ?? 0

  return {
    totalVenues,
    withHhData,
    withHhConfirmation,
    coveragePct: totalVenues > 0 ? withHhData / totalVenues : 0,
    confirmedPct: totalVenues > 0 ? withHhConfirmation / totalVenues : 0,
  }
}

async function getInventoryStats() {
  const [verifiedRes, unverifiedRes, staleRes, closedRes] = await Promise.all([
    supabase.from('venues').select('id', { count: 'exact', head: true }).eq('status', 'verified'),
    supabase.from('venues').select('id', { count: 'exact', head: true }).eq('status', 'unverified'),
    supabase.from('venues').select('id', { count: 'exact', head: true }).eq('status', 'stale'),
    supabase.from('venues').select('id', { count: 'exact', head: true }).eq('status', 'closed'),
  ])

  const verified = verifiedRes.count ?? 0
  const unverified = unverifiedRes.count ?? 0
  const stale = staleRes.count ?? 0
  const closed = closedRes.count ?? 0

  return { verified, unverified, stale, closed, total: verified + unverified + stale + closed }
}

async function getContributors() {
  const res = await supabase
    .from('events')
    .select('device_hash, metadata')
    .eq('event_name', 'scan_complete')
    .gte('created_at', weekStart())
    .limit(1000)

  const deviceMap: Record<string, { submissions: number; confirmations: number }> = {}

  ;(res.data ?? []).forEach((row: { device_hash: string; metadata?: { hhWasEdited?: boolean } }) => {
    const dh = row.device_hash
    if (!deviceMap[dh]) deviceMap[dh] = { submissions: 0, confirmations: 0 }
    deviceMap[dh].submissions++
  })

  // confirmations from venue_flag_events
  const confirmedRes = await supabase
    .from('venue_flag_events')
    .select('device_hash')
    .eq('action', 'confirm')
    .gte('created_at', weekStart())
    .limit(1000)

  ;(confirmedRes.data ?? []).forEach((row: { device_hash: string }) => {
    const dh = row.device_hash
    if (!deviceMap[dh]) deviceMap[dh] = { submissions: 0, confirmations: 0 }
    deviceMap[dh].confirmations++
  })

  const topDevices = Object.entries(deviceMap)
    .sort((a, b) => b[1].submissions - a[1].submissions)
    .slice(0, 10)
    .map(([deviceHash, stats]) => ({ deviceHash, ...stats }))

  return { topDevices }
}

async function getModerationStats() {
  const today = todayStart()
  const week = weekStart()

  let flagEventsToday = 0
  let flagEventsThisWeek = 0

  try {
    const [todayRes, weekRes] = await Promise.all([
      supabase.from('venue_flag_events').select('id', { count: 'exact', head: true }).eq('action', 'flag').gte('created_at', today),
      supabase.from('venue_flag_events').select('id', { count: 'exact', head: true }).eq('action', 'flag').gte('created_at', week),
    ])
    flagEventsToday = todayRes.count ?? 0
    flagEventsThisWeek = weekRes.count ?? 0
  } catch {
    // table may not exist
  }

  const staleRes = await supabase.from('venues').select('id', { count: 'exact', head: true }).eq('status', 'stale')
  const staleVenues = staleRes.count ?? 0

  // abusive = devices with >5 flags in last 30 days
  const thirtyDaysAgo = daysAgo(30)
  let abusiveDevices = 0
  try {
    const abusiveRes = await supabase
      .from('venue_flag_events')
      .select('device_hash')
      .eq('action', 'flag')
      .gte('created_at', thirtyDaysAgo)

    const flagCount: Record<string, number> = {}
    ;(abusiveRes.data ?? []).forEach((row: { device_hash: string }) => {
      flagCount[row.device_hash] = (flagCount[row.device_hash] ?? 0) + 1
    })
    abusiveDevices = Object.values(flagCount).filter(c => c > 5).length
  } catch {
    // table may not exist
  }

  return { flagEventsToday, flagEventsThisWeek, staleVenues, abusiveDevices }
}

async function getTopVenues() {
  // Top 10 venues by views in the last 30 days — from venue_view events
  const thirtyDaysAgo = daysAgo(30)

  const res = await supabase
    .from('events')
    .select('venue_id')
    .eq('event_name', 'venue_view')
    .gte('created_at', thirtyDaysAgo)
    .limit(5000)

  const viewCount: Record<string, number> = {}
  ;(res.data ?? []).forEach((row: { venue_id?: string }) => {
    if (row.venue_id) {
      viewCount[row.venue_id] = (viewCount[row.venue_id] ?? 0) + 1
    }
  })

  const topIds = Object.entries(viewCount)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([id]) => id)

  if (topIds.length === 0) return { topVenues: [] }

  // Fetch name + status for each top venue
  const venuesRes = await supabase
    .from('venues')
    .select('id, name, status')
    .in('id', topIds)

  const venueMeta: Record<string, { name: string; status: string }> = {}
  ;(venuesRes.data ?? []).forEach((row: { id: string; name: string; status: string }) => {
    venueMeta[row.id] = { name: row.name, status: row.status }
  })

  const topVenues = topIds.map(id => ({
    id,
    name: venueMeta[id]?.name ?? 'Unknown',
    status: venueMeta[id]?.status ?? 'unknown',
    views: viewCount[id] ?? 0,
  }))

  return { topVenues }
}

async function getTopCities() {
  // Public-safe aggregate: ranks cities by venue_view count — measures where usage is concentrated,
  // not where data is (which is a function of OSM seeding, not user activity).
  const thirtyDaysAgo = daysAgo(30)

  // Aggregate view counts per venue_id first (from events), then join to venues for city info
  const res = await supabase
    .from('events')
    .select('venue_id')
    .eq('event_name', 'venue_view')
    .gte('created_at', thirtyDaysAgo)
    .limit(5000)

  const viewCount: Record<string, number> = {}
  ;(res.data ?? []).forEach((row: { venue_id?: string }) => {
    if (row.venue_id) viewCount[row.venue_id] = (viewCount[row.venue_id] ?? 0) + 1
  })

  const venueIds = Object.keys(viewCount)
  if (venueIds.length === 0) return { topCities: [] }

  // Fetch city/state for all venues that received views
  const venuesRes = await supabase
    .from('venues')
    .select('id, city, state')
    .in('id', venueIds)

  // Sum views per city (city + state as the key, for disambiguation like Springfield, OR vs Springfield, MA)
  const cityViewCount: Record<string, { city: string; state: string; views: number }> = {}
  ;(venuesRes.data ?? []).forEach((row: { id: string; city?: string; state?: string }) => {
    if (!row.city && !row.state) return
    const key = `${row.city ?? ''}, ${row.state ?? ''}`.trim()
    if (!key) return
    if (!cityViewCount[key]) cityViewCount[key] = { city: row.city ?? '', state: row.state ?? '', views: 0 }
    cityViewCount[key].views += viewCount[row.id] ?? 0
  })

  const topCities = Object.entries(cityViewCount)
    .sort((a, b) => b[1].views - a[1].views)
    .slice(0, 10)
    .map(([, v]) => ({ city: v.city, state: v.state, views: v.views }))

  return { topCities }
}

async function getPresenceStats() {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const res = await supabase
    .from('presence')
    .select('device_hash', { count: 'exact', head: true })
    .gte('last_seen', fiveMinAgo)

  return {
    onlineNow: res.count ?? 0,
    lastUpdated: new Date().toISOString(),
  }
}


// Internal-only: search analytics from 'search' events.
async function getSearchStats() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: allSearchRes, count: totalSearches } = await supabase
    .from('events')
    .select('metadata', { count: 'exact' })
    .eq('event_name', 'search')
    .gte('created_at', thirtyDaysAgo)
    .limit(500)

  const allSearches = allSearchRes ?? []

  // Query-type breakdown
  const byQueryType: Record<string, number> = {}
  allSearches.forEach((row: { metadata?: { queryType?: string } }) => {
    const qt = row.metadata?.queryType ?? 'unknown'
    byQueryType[qt] = (byQueryType[qt] ?? 0) + 1
  })

  // Average result count
  const resultCounts = allSearches
    .map((row: { metadata?: { resultCount?: number } }) => row.metadata?.resultCount ?? 0)
    .filter((n: number) => n > 0)
  const avgResultCount = resultCounts.length > 0
    ? resultCounts.reduce((a: number, b: number) => a + b, 0) / resultCounts.length
    : null

  // Zero-result searches (high intent, no match)
  const zeroResultSearches = allSearches.filter(
    (row: { metadata?: { resultCount?: number } }) => (row.metadata?.resultCount ?? 0) === 0
  ).length

  // Top queries by frequency
  const queryCount: Record<string, number> = {}
  allSearches.forEach((row: { metadata?: { query?: string } }) => {
    const q = row.metadata?.query ?? ''
    if (!q) return
    queryCount[q] = (queryCount[q] ?? 0) + 1
  })
  const topQueries = Object.entries(queryCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([query, count]) => ({ query, count }))

  return { totalSearches: totalSearches ?? 0, byQueryType, avgResultCount, zeroResultSearches, topQueries }
}


export async function GET() {
  try {
    const [funnel, volume, coverage, inventory, contributors, moderation, presence, topVenues, topCities, liveHhCount, userCounts, parseQuality, coverageGaps, dataAging, growthTrends, searchStats] = await Promise.all([
      getFunnelStats(),
      getVolumeStats(),
      getCoverageStats(),
      getInventoryStats(),
      getContributors(),
      getModerationStats(),
      getPresenceStats(),
      getTopVenues(),
      getTopCities(),
      getLiveHhCount(),
      getUserCounts(),
      getParseQuality(),
      getCoverageGaps(),
      getDataAging(),
      getGrowthTrends(),
      getSearchStats(),
    ])

    return NextResponse.json({ funnel, volume, coverage, inventory, contributors, moderation, presence, topVenues, topCities, liveHhCount, userCounts, parseQuality, coverageGaps, dataAging, growthTrends, searchStats })
  } catch (err) {
    console.error('devdash stats error:', err)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}

// Public-safe aggregate: venues with HH active right now
async function getLiveHhCount() {
  // Fetch venues that have HH data (type column set) and evaluate hasActiveHappyHour server-side.
  // At scale (thousands of venues) this loop warrants caching; fine at current volume.
  const res = await supabase
    .from('venues')
    .select('id, hh_type, hh_time, hh_days, hh_exclude_days, hh_start, hh_end, hh_type_2, hh_days_2, hh_exclude_days_2, hh_start_2, hh_end_2, hh_type_3, hh_days_3, hh_exclude_days_3, hh_start_3, hh_end_3, opening_min')
    .not('hh_type', 'is', null)
    .limit(2000)

  const venues = res.data ?? []
  let liveCount = 0
  for (const v of venues) {
    if (hasActiveHappyHour(v as Parameters<typeof hasActiveHappyHour>[0])) liveCount++
  }
  return { liveHhCount: liveCount, totalWithHhData: venues.length }
}

// Internal-only: broader user counts (device hashes are identifiable)
async function getUserCounts() {
  const today = todayStart()
  const week = weekStart()

  // Fetch all device_hash values and deduplicate in JS.
  // Supabase JS v2 doesn't expose count(distinct) directly; this is simple and fine at current scale.
  // For all-time, use a high limit to keep it bounded; exact at small-to-mid scale.
  const [todayRes, weekRes, allTimeRes] = await Promise.all([
    supabase.from('events').select('device_hash').gte('created_at', today).limit(5000),
    supabase.from('events').select('device_hash').gte('created_at', week).limit(5000),
    supabase.from('events').select('device_hash').limit(10000),
  ])

  const uniqueToday = new Set((todayRes.data ?? []).map((r: { device_hash: string }) => r.device_hash).filter(Boolean))
  const uniqueWeek = new Set((weekRes.data ?? []).map((r: { device_hash: string }) => r.device_hash).filter(Boolean))
  const uniqueAllTime = new Set((allTimeRes.data ?? []).map((r: { device_hash: string }) => r.device_hash).filter(Boolean))

  return {
    // Distinct active devices (any event) today / this week — "people who used the app"
    activeDevicesToday: uniqueToday.size,
    activeDevicesThisWeek: uniqueWeek.size,
    // All-time distinct devices — "total humans who've used PourList"
    allTimeDevices: uniqueAllTime.size,
  }
}

// Performance note: uses JS bucketing in-memory. At PourList's current scale (~dozens of
// user-created venues, ~thousands of events) this is fine. At scale (100K+ venues/events)
// this should move to a Supabase RPC with date_trunc, or cache the weekly buckets with
// a 5-minute revalidation tag. Flagged for evaluation when data volume grows.
async function getGrowthTrends() {
  const MS_PER_DAY = 86_400_000
  const now = new Date()

  // Build week-start buckets for the last 8 complete weeks
  function weekStart(date: Date): string {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - d.getDay()) // Sunday
    return d.toISOString().slice(0, 10)
  }
  const weeks: string[] = []
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i * 7)
    weeks.push(weekStart(d))
  }
  const weekIndex: Record<string, number> = Object.fromEntries(weeks.map((w, i) => [w, i]))

  // Fetch venues with HH data — for HH-venue count over time
  const venuesRes = await supabase
    .from('venues')
    .select('created_at, hh_type, last_verified')
    .neq('status', 'unverified')
    .not('hh_type', 'is', null)
    .limit(5000)

  // Fetch scan_complete events — for submission volume over time
  const eventsRes = await supabase
    .from('events')
    .select('created_at, metadata')
    .eq('event_name', 'scan_complete')
    .gte('created_at', weeks[0])
    .limit(5000)

  // Bucket venues with HH data by week (use last_verified if available, else created_at)
  const venueCounts = new Array(weeks.length).fill(0)
  ;(venuesRes.data ?? []).forEach((row: { created_at: string; last_verified?: string; hh_type?: string }) => {
    const ts = row.last_verified ?? row.created_at
    if (!ts) return
    const ws = weekStart(new Date(ts))
    if (ws in weekIndex) venueCounts[weekIndex[ws]]++
  })

  // Bucket scan_complete events by week; also track new venue count from metadata
  const submissionCounts = new Array(weeks.length).fill(0)
  const newVenueCounts = new Array(weeks.length).fill(0)
  ;(eventsRes.data ?? []).forEach((row: { created_at: string; metadata?: { isNewVenue?: boolean } }) => {
    const ws = weekStart(new Date(row.created_at))
    if (ws in weekIndex) {
      submissionCounts[weekIndex[ws]]++
      if (row.metadata?.isNewVenue) newVenueCounts[weekIndex[ws]]++
    }
  })

  const venueTrend = weeks.map((w, i) => ({ week: w, count: venueCounts[i] }))
  const submissionTrend = weeks.map((w, i) => ({ week: w, submissions: submissionCounts[i], newVenues: newVenueCounts[i] }))

  return { venueTrend, submissionTrend }
}

// Public-safe aggregate: age breakdown of venues with HH data.
// Age = last_verified (best proxy; updated on photo approval) or created_at as fallback.
async function getDataAging() {
  const res = await supabase
    .from('venues')
    .select('last_verified, created_at')
    .neq('status', 'unverified')
    .not('hh_type', 'is', null)
    .limit(5000)

  const now = Date.now()
  const buckets = { fresh: 0, aging: 0, stale: 0, old: 0 }
  const MS_PER_DAY = 86_400_000
  ;(res.data ?? []).forEach((row: { last_verified?: string; created_at: string }) => {
    const ts = row.last_verified ?? row.created_at
    const ageDays = (now - new Date(ts).getTime()) / MS_PER_DAY
    if (ageDays < 90)  buckets.fresh++
    else if (ageDays < 180) buckets.aging++
    else if (ageDays < 365) buckets.stale++
    else buckets.old++
  })
  return buckets
}

// Public-safe aggregate: cities with map presence but zero HH data — "empty pins" ranked by pin count.
// Useful as a contribution-priority signal: these cities have users but no real data yet.
async function getCoverageGaps() {
  // Fetch all user-created venues with city/state and HH type
  const res = await supabase
    .from('venues')
    .select('city, state, hh_type')
    .neq('status', 'unverified')
    .limit(5000)

  // Group by city+state, count total and HH-equipped
  const cityStats: Record<string, { city: string; state: string; total: number; withHh: number }> = {}
  ;(res.data ?? []).forEach((row: { city?: string; state?: string; hh_type?: string }) => {
    const key = `${row.city ?? ''}|${row.state ?? ''}`
    if (!key || key === '|') return
    if (!cityStats[key]) cityStats[key] = { city: row.city ?? '', state: row.state ?? '', total: 0, withHh: 0 }
    cityStats[key].total++
    if (row.hh_type) cityStats[key].withHh++
  })

  const gaps = Object.values(cityStats)
    .filter(c => c.total > 0 && c.withHh === 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 20)
    .map(c => ({ city: c.city, state: c.state, emptyPins: c.total }))

  return { coverageGaps: gaps }
}

// Internal-only: parse quality metrics
// Note: raw user-submitted text is not retained. Failed-parse log is forward-only —
// only captures parse_failure events logged after this change. Historical failures are not available.
async function getParseQuality() {
  const thirtyDaysAgo = daysAgo(30)

  // 1. Parse success rate: scan_complete with non-empty menu_text vs parse_failure events
  const [completesRes, failuresRes, allHhRes] = await Promise.all([
    supabase.from('events').select('id', { count: 'exact', head: true })
      .eq('event_name', 'scan_complete').gte('created_at', thirtyDaysAgo),
    supabase.from('events').select('id', { count: 'exact', head: true })
      .eq('event_name', 'parse_failure').gte('created_at', thirtyDaysAgo),
    supabase.from('venues').select('hh_type').not('hh_type', 'is', null).limit(5000),
  ])

  const completes = completesRes.count ?? 0
  const failures = failuresRes.count ?? 0
  const totalAttempts = completes + failures
  const parseSuccessRate = totalAttempts > 0 ? completes / totalAttempts : null

  // 2. HH-type distribution: among venues with HH type set, count by type
  const hhTypeCount: Record<string, number> = {}
  ;(allHhRes.data ?? []).forEach((row: { hh_type?: string }) => {
    const t = row.hh_type ?? 'unknown'
    hhTypeCount[t] = (hhTypeCount[t] ?? 0) + 1
  })

  // 3. Failed-parse log: most recent ~25 forward-only (hh_blocked_input only — not gpt_image noise)
  const failedRes = await supabase
    .from('events')
    .select('created_at, metadata')
    .eq('event_name', 'parse_failure')
    .gte('created_at', thirtyDaysAgo)
    .order('created_at', { ascending: false })
    .limit(25)

  const failedParses = (failedRes.data ?? []).map((row: { created_at: string; metadata?: { failureType?: string; rawText?: string; error?: string; hhSummary?: string } }) => ({
    timestamp: row.created_at,
    failureType: row.metadata?.failureType ?? null,
    rawText: row.metadata?.rawText ?? null,
    error: row.metadata?.error ?? null,
    hhSummary: row.metadata?.hhSummary ?? null,
  }))

  return {
    parseSuccessRate: parseSuccessRate ?? null,
    parseFailureCount: failures,
    parseCompleteCount: completes,
    hhTypeDistribution: hhTypeCount,
    failedParseLog: failedParses,
    failedParseLogNote: 'Forward-only: only captures failures logged after this change. Historical failures not retained.',
  }
}
