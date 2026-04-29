/**
 * GET /api/devdash/stats
 * Returns aggregated stats for the dev dashboard.
 * Uses Supabase service role key to bypass RLS.
 * Revalidated every 5 minutes via ISR revalidate tag.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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
  const totalRes = await supabase.from('venues').select('id', { count: 'exact', head: true })
  const withHhRes = await supabase.from('venues').select('id', { count: 'exact', head: true }).not('hh_type', 'is', null)
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

export async function GET() {
  try {
    const [funnel, volume, coverage, inventory, contributors, moderation, presence] = await Promise.all([
      getFunnelStats(),
      getVolumeStats(),
      getCoverageStats(),
      getInventoryStats(),
      getContributors(),
      getModerationStats(),
      getPresenceStats(),
    ])

    return NextResponse.json({ funnel, volume, coverage, inventory, contributors, moderation, presence })
  } catch (err) {
    console.error('devdash stats error:', err)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}