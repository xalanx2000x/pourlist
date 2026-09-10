/**
 * GET /api/devdash/debug
 * Temporary debug endpoint — returns raw distinct device counts without row caps.
 * Remove after testing.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  // Total events
  const { count: totalEvents } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })

  // All distinct devices (NO limit — supabase-js auto-paginates)
  const { data: allDeviceRows } = await supabase
    .from('events')
    .select('device_hash')
    .not('device_hash', 'is', null)

  const uniqueAllTime = new Set(
    (allDeviceRows || []).map((r: { device_hash: string }) => r.device_hash).filter(Boolean)
  )

  // 7-day distinct
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { data: weekDeviceRows } = await supabase
    .from('events')
    .select('device_hash')
    .not('device_hash', 'is', null)
    .gte('created_at', weekStart)

  const uniqueWeek = new Set(
    (weekDeviceRows || []).map((r: { device_hash: string }) => r.device_hash).filter(Boolean)
  )

  // Today's distinct
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const { data: todayDeviceRows } = await supabase
    .from('events')
    .select('device_hash')
    .not('device_hash', 'is', null)
    .gte('created_at', todayStart.toISOString())

  const uniqueToday = new Set(
    (todayDeviceRows || []).map((r: { device_hash: string }) => r.device_hash).filter(Boolean)
  )

  // Also check: distinct devices from scan_start events only (what the volume stats use)
  const { data: scanDeviceRows } = await supabase
    .from('events')
    .select('device_hash')
    .eq('event_name', 'scan_start')
    .not('device_hash', 'is', null)

  const uniqueScanDevices = new Set(
    (scanDeviceRows || []).map((r: { device_hash: string }) => r.device_hash).filter(Boolean)
  )

  // Daily venue_view counts — last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: viewRows } = await supabase
    .from('events')
    .select('created_at')
    .eq('event_name', 'venue_view')
    .gte('created_at', thirtyDaysAgo)

  const viewCountsByDay: Record<string, number> = {}
  ;(viewRows || []).forEach((r: { created_at: string }) => {
    const day = r.created_at.slice(0, 10) // YYYY-MM-DD
    viewCountsByDay[day] = (viewCountsByDay[day] || 0) + 1
  })

  // Daily venue_view counts — all time
  const { data: allViewRows } = await supabase
    .from('events')
    .select('created_at')
    .eq('event_name', 'venue_view')

  const allTimeViews = allViewRows?.length ?? 0
  const allTimeViewsByDay: Record<string, number> = {}
  ;(allViewRows || []).forEach((r: { created_at: string }) => {
    const day = r.created_at.slice(0, 10)
    allTimeViewsByDay[day] = (allTimeViewsByDay[day] || 0) + 1
  })

  // Daily scan_start counts — last 30 days
  const { data: scanRows } = await supabase
    .from('events')
    .select('created_at')
    .eq('event_name', 'scan_start')
    .gte('created_at', thirtyDaysAgo)

  const scanCountsByDay: Record<string, number> = {}
  ;(scanRows || []).forEach((r: { created_at: string }) => {
    const day = r.created_at.slice(0, 10)
    scanCountsByDay[day] = (scanCountsByDay[day] || 0) + 1
  })

  return NextResponse.json({
    totalEvents,
    allTimeDevices: uniqueAllTime.size,
    weekDevices: uniqueWeek.size,
    todayDevices: uniqueToday.size,
    scanDevices: uniqueScanDevices.size,
    allDeviceRowsFetched: allDeviceRows?.length ?? 0,
    weekDeviceRowsFetched: weekDeviceRows?.length ?? 0,
    todayDeviceRowsFetched: todayDeviceRows?.length ?? 0,
    scanDeviceRowsFetched: scanDeviceRows?.length ?? 0,
    // Daily venue views — last 30 days
    venueViewsLast30d: viewCountsByDay,
    venueViewsAllTimeTotal: allTimeViews,
    venueViewsAllTimeByDay: allTimeViewsByDay,
    // Daily scans — last 30 days
    scansLast30d: scanCountsByDay,
  })
}
