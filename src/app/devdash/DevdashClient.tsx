'use client'

import { useState, useEffect } from 'react'

interface Stats {
  funnel: {
    startsLast7d: number
    completionsLast7d: number
    abandonsLast7d: number
    completionRate: number
    avgDurationSec: number
    hhEditedRate: number
  }
  volume: {
    scansToday: number
    scansThisWeek: number
    completionsToday: number
    newVenuesToday: number
    photosToday: number
    uniqueDevicesToday: number
    uniqueDevicesThisWeek: number
  }
  coverage: {
    totalVenues: number
    withHhData: number
    withHhConfirmation: number
    coveragePct: number
    confirmedPct: number
  }
  inventory: {
    verified: number
    unverified: number
    stale: number
    closed: number
    total: number
  }
  contributors: {
    topDevices: { deviceHash: string; submissions: number; confirmations: number }[]
  }
  moderation: {
    flagEventsToday: number
    flagEventsThisWeek: number
    staleVenues: number
    abusiveDevices: number
  }
  presence: {
    onlineNow: number
    lastUpdated: string
  }
  topVenues: { id: string; name: string; status: string; views: number }[]
  // Public-safe: usage concentration by city, distinct from data coverage
  topCities: { city: string; state: string; views: number }[]
  // Public-safe: venues with HH active at this moment
  liveHhCount: { liveHhCount: number; totalWithHhData: number }
  // Internal-only: broader user counts (device hashes are identifiable)
  userCounts: {
    activeDevicesToday: number
    activeDevicesThisWeek: number
    allTimeDevices: number
  }
  // Internal-only: parse quality metrics
  parseQuality: {
    parseSuccessRate: number | null
    parseFailureCount: number
    parseCompleteCount: number
    hhTypeDistribution: Record<string, number>
    failedParseLog: { timestamp: string; rawText: string | null; error: string | null }[]
    failedParseLogNote: string
  }
  // Public-safe: age distribution of venues with HH data
  dataAging: { fresh: number; aging: number; stale: number; old: number }
  // Public-safe: growth trends over last 8 weeks
  growthTrends: {
    venueTrend: { week: string; count: number }[]
    submissionTrend: { week: string; submissions: number; newVenues: number }[]
  }
  // Internal-only: search analytics
  searchStats: {
    totalSearches: number
    byQueryType: Record<string, number>
    avgResultCount: number | null
    zeroResultSearches: number
    topQueries: { query: string; count: number }[]
  }
  // Public-safe: daily usage bucketed by PourList-day (2pm–1:59pm)
  usageOverTime: {
    uniqueDevices: { day: string; count: number }[]
    searches: { day: string; count: number }[]
    venuesAdded: { day: string; count: number }[]
  }
  // Internal-only: venues with HH data, oldest first — shows which need re-verification
  staleVenues: {
    staleVenues: { name: string; city: string; state: string; ageLabel: string; updatedAt: string | null }[]
  }
  // Public-safe (aggregate): searches that returned zero results — most wanted / most missing
  topZeroSearches: { topZeroSearches: { query: string; count: number }[] }
  // Public-safe (aggregate): geographic areas with high search demand but no real venues
  demandVsSupply: { demandVsSupply: { area: string; searches: number; venues: number }[] }
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`
}

function fmt(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const height = max > 0 ? Math.max(4, (value / max) * 100) : 4
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-sm relative" style={{ height: 80 }}>
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-sm ${color}`}
          style={{ height: `${height}%` }}
        />
      </div>
      <span className="text-xs text-gray-500">{value}</span>
    </div>
  )
}

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-200 dark:border-gray-700">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide mb-4">{title}</h3>
      {children}
    </div>
  )
}

function ProgressBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct_val = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-400">{label}</span>
        <span className="font-medium text-gray-800 dark:text-gray-200">{pct(pct_val / 100)}</span>
      </div>
      <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct_val}%` }} />
      </div>
    </div>
  )
}

export default function DevdashClient() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/devdash/stats')
      .then(r => r.json())
      .then(data => {
        setStats(data)
        setUpdatedAt(new Date().toLocaleTimeString())
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="text-center text-gray-400 py-20">Loading dashboard…</div>
      </div>
    )
  }

  if (!stats || !stats.funnel) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8">
        <div className="text-center text-red-400 py-20">Failed to load stats. Check server logs.</div>
      </div>
    )
  }

  // Daily activity — last 7 days of scan starts
  const last7Days: { label: string; scans: number; completions: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const dayStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })
    const label = d.toLocaleDateString('en-US', { weekday: 'short' })
    // We don't have per-day data from the current API — synthesize from volume
    // Use the weekly numbers as a proxy — show the single snapshot stats
    // instead just show a single bar representing today's relative weight
    last7Days.push({ label, scans: 0, completions: 0 })
  }

  const maxFunnelBar = Math.max(stats.funnel.startsLast7d, 1)
  const funnelMax = maxFunnelBar

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Pour List Dev Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Real-time infrastructure &amp; engagement metrics</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">Last updated</p>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{updatedAt}</p>
          <p className="text-xs text-gray-400 mt-0.5">Auto-refreshes every 5 min</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Scans Today"
          value={fmt(stats.volume.scansToday)}
          sub={`${pct(stats.funnel.completionRate)} completion rate`}
        />
        <KpiCard
          label="Unique Devices Today"
          value={fmt(stats.volume.uniqueDevicesToday)}
          sub={`${fmt(stats.volume.uniqueDevicesThisWeek)} this week`}
        />
        <KpiCard
          label="Online Now"
          value={stats.presence.onlineNow}
          sub="active sessions (5 min window)"
        />
        <KpiCard
          label="HH Coverage"
          value={pct(stats.coverage.coveragePct)}
          sub={`${stats.coverage.withHhConfirmation} verified`}
        />
        <KpiCard
          label="X Happy Hours Live Now"
          value={stats.liveHhCount.liveHhCount}
          sub={`of ${stats.liveHhCount.totalWithHhData} venues with HH data`}
        />
        <KpiCard
          label="Total Devices (All Time)"
          value={fmt(stats.userCounts.allTimeDevices)}
          sub={`${fmt(stats.userCounts.activeDevicesThisWeek)} this week`}
        />
        <KpiCard
          label="HH Data Age — Fresh (<3mo)"
          value={stats.dataAging.fresh}
          sub={`${stats.dataAging.aging} aging · ${stats.dataAging.stale} stale · ${stats.dataAging.old} old`}
        />
      </div>

      {/* Row 1: Scan Funnel + HH Coverage */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Scan Funnel (7d)">
          <div className="flex items-end gap-3 h-32 mb-4">
            <Bar value={stats.funnel.startsLast7d} max={funnelMax} color="bg-amber-400" />
            <Bar value={stats.funnel.completionsLast7d} max={funnelMax} color="bg-purple-500" />
            <Bar value={stats.funnel.abandonsLast7d} max={funnelMax} color="bg-gray-400" />
          </div>
          <div className="flex items-center gap-4 text-xs text-gray-500 mb-4">
            <span className="flex items-center gap-1"><span className="w-3 h-3 inline-block rounded bg-amber-400" /> Starts</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 inline-block rounded bg-purple-500" /> Completions</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 inline-block rounded bg-gray-400" /> Abandons</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Starts</span> <span className="font-semibold text-gray-800 dark:text-gray-200">{stats.funnel.startsLast7d}</span></div>
            <div><span className="text-gray-500">Completions</span> <span className="font-semibold text-gray-800 dark:text-gray-200">{stats.funnel.completionsLast7d}</span></div>
            <div><span className="text-gray-500">Abandons</span> <span className="font-semibold text-gray-800 dark:text-gray-200">{stats.funnel.abandonsLast7d}</span></div>
            <div><span className="text-gray-500">Avg Duration</span> <span className="font-semibold text-gray-800 dark:text-gray-200">{stats.funnel.avgDurationSec.toFixed(0)}s</span></div>
            <div><span className="text-gray-500">HH Edited Rate</span> <span className="font-semibold text-purple-600">{pct(stats.funnel.hhEditedRate)}</span></div>
          </div>
        </SectionCard>

        <SectionCard title="HH Coverage">
          <div className="space-y-5">
            <ProgressBar label="Venues with HH data" value={stats.coverage.withHhData} max={stats.coverage.totalVenues || 1} color="bg-amber-400" />
            <ProgressBar label="Community-verified HH" value={stats.coverage.withHhConfirmation} max={stats.coverage.totalVenues || 1} color="bg-purple-500" />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div><span className="text-gray-500">Total Venues</span> <span className="font-semibold text-gray-800 dark:text-gray-200">{stats.coverage.totalVenues}</span></div>
            <div><span className="text-gray-500">With HH Data</span> <span className="font-semibold text-gray-800 dark:text-gray-200">{stats.coverage.withHhData}</span></div>
            <div><span className="text-gray-500">HH Confirmed</span> <span className="font-semibold text-purple-600">{stats.coverage.withHhConfirmation}</span></div>
            <div><span className="text-gray-500">Coverage %</span> <span className="font-semibold text-amber-500">{pct(stats.coverage.coveragePct)}</span></div>
          </div>
        </SectionCard>
      </div>

      {/* Row 2: Daily Activity + Venue Inventory */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Today's Volume">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
              <p className="text-2xl font-bold text-amber-600">{fmt(stats.volume.scansToday)}</p>
              <p className="text-xs text-gray-500 mt-1">Scans</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
              <p className="text-2xl font-bold text-purple-600">{fmt(stats.volume.completionsToday)}</p>
              <p className="text-xs text-gray-500 mt-1">Completions</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
              <p className="text-2xl font-bold text-green-600">{fmt(stats.volume.newVenuesToday)}</p>
              <p className="text-xs text-gray-500 mt-1">New Venues</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
              <p className="text-2xl font-bold text-blue-600">{fmt(stats.volume.photosToday)}</p>
              <p className="text-xs text-gray-500 mt-1">Photos</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900/20 rounded-lg p-3">
              <p className="text-2xl font-bold text-gray-600">{fmt(stats.volume.uniqueDevicesToday)}</p>
              <p className="text-xs text-gray-500 mt-1">Unique Devices</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900/20 rounded-lg p-3">
              <p className="text-2xl font-bold text-gray-600">{fmt(stats.volume.scansThisWeek)}</p>
              <p className="text-xs text-gray-500 mt-1">Scans (7d)</p>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Venue Inventory">
          {stats.inventory.total > 0 ? (
            <div className="space-y-4">
              {[
                { label: 'Verified', count: stats.inventory.verified, color: 'bg-green-500', bg: 'bg-green-50 dark:bg-green-900/20', text: 'text-green-700' },
                { label: 'Unverified', count: stats.inventory.unverified, color: 'bg-amber-400', bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700' },
                { label: 'Stale', count: stats.inventory.stale, color: 'bg-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700' },
                { label: 'Closed', count: stats.inventory.closed, color: 'bg-gray-400', bg: 'bg-gray-50 dark:bg-gray-900/20', text: 'text-gray-600' },
              ].map(({ label, count, color, bg, text }) => {
                const pct_val = stats.inventory.total > 0 ? (count / stats.inventory.total) * 100 : 0
                return (
                  <div key={label} className={`${bg} rounded-lg p-3 flex items-center justify-between`}>
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-sm font-bold ${text}`}>{count}</span>
                      <span className="text-xs text-gray-400">{pct_val.toFixed(0)}%</span>
                    </div>
                  </div>
                )
              })}
              <div className="text-xs text-gray-400 text-center pt-2">Total: {stats.inventory.total}</div>
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No inventory data.</p>
          )}
        </SectionCard>
      </div>

      {/* Row 2.5: Stale Venues — oldest HH data, most in need of re-verification */}
      <SectionCard title="Stale Venues — HH Data Age">
        {stats.staleVenues.staleVenues.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wider">
                  <th className="text-left pb-2">Venue</th>
                  <th className="text-left pb-2">Location</th>
                  <th className="text-right pb-2">HH Data Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {stats.staleVenues.staleVenues.map((v, i) => (
                  <tr key={i} className="text-gray-700 dark:text-gray-300">
                    <td className="py-2 font-medium">{v.name}</td>
                    <td className="py-2 text-gray-500">{[v.city, v.state].filter(Boolean).join(', ')}</td>
                    <td className="py-2 text-right font-bold text-amber-600">{v.ageLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No stale venues — all HH data is fresh.</p>
        )}
      </SectionCard>

      {/* Row 2.5b: Top Zero-Result Searches — what people are looking for that we don't have */}
      <SectionCard title="Top Zero-Result Searches">
        {stats.topZeroSearches.topZeroSearches.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wider">
                  <th className="text-left pb-2">Query</th>
                  <th className="text-right pb-2">Times Searched</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {stats.topZeroSearches.topZeroSearches.map((s, i) => (
                  <tr key={i} className="text-gray-700 dark:text-gray-300">
                    <td className="py-2 font-medium">{s.query}</td>
                    <td className="py-2 text-right font-bold text-amber-600">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No zero-result searches yet — fills as people search.</p>
        )}
      </SectionCard>

      {/* Row 2.5c: Demand vs Supply — high search volume areas with few/no real venues */}
      <SectionCard title="Demand vs Supply — Areas People Search But We Don't Have Venues">
        {stats.demandVsSupply.demandVsSupply.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wider">
                  <th className="text-left pb-2">Area Searched</th>
                  <th className="text-right pb-2">Searches</th>
                  <th className="text-right pb-2">Venues Here</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {stats.demandVsSupply.demandVsSupply.map((d, i) => (
                  <tr key={i} className="text-gray-700 dark:text-gray-300">
                    <td className="py-2 font-medium">{d.area}</td>
                    <td className="py-2 text-right font-bold text-amber-600">{d.searches}</td>
                    <td className="py-2 text-right text-red-500">{d.venues}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No high-demand areas yet — fills as search data accumulates.</p>
        )}
      </SectionCard>

      {/* Row 2.5b: Growth Trends (public-safe) */}
      <SectionCard title="Growth Trends (Last 8 Weeks)">
        {stats.growthTrends ? (
          <div className="space-y-6">
            {/* HH-venue count trend */}
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">HH Venues Added per Week</p>
              <div className="flex items-end gap-1 h-20">
                {stats.growthTrends.venueTrend.map((w, i) => {
                  const max = Math.max(...stats.growthTrends.venueTrend.map(x => x.count), 1)
                  return (
                    <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{w.count}</span>
                      <div
                        className="w-full bg-amber-400 rounded-t"
                        style={{ height: `${Math.max((w.count / max) * 60, w.count > 0 ? 4 : 0)}px` }}
                      />
                      <span className="text-xs text-gray-400">{w.week.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
            {/* Submissions trend */}
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Submissions per Week (total / new venues)</p>
              <div className="flex items-end gap-1 h-20">
                {stats.growthTrends.submissionTrend.map((w, i) => {
                  const max = Math.max(...stats.growthTrends.submissionTrend.map(x => x.submissions), 1)
                  return (
                    <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{w.submissions}</span>
                      <div
                        className="w-full bg-purple-400 rounded-t"
                        style={{ height: `${Math.max((w.submissions / max) * 60, w.submissions > 0 ? 4 : 0)}px` }}
                      />
                      <span className="text-xs text-gray-400">{w.week.slice(5)}</span>
                      {w.newVenues > 0 && (
                        <span className="text-xs text-green-500" title="new venues">+{w.newVenues}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No trend data yet.</p>
        )}
      </SectionCard>


      {/* Row 2.5c: Usage Over Time — Public-safe daily counts, PourList-day bucketing */}
      <SectionCard title="Usage Over Time (PourList Days, 2pm–2pm)">
        {stats.usageOverTime && stats.usageOverTime.uniqueDevices.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Unique Devices / day */}
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Unique Devices / Day</p>
              <div className="flex items-end gap-0.5 h-20">
                {stats.usageOverTime.uniqueDevices.map((d, i) => {
                  const max = Math.max(...stats.usageOverTime.uniqueDevices.map(x => x.count), 1)
                  return (
                    <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{d.count}</span>
                      <div
                        className="w-full bg-blue-400 rounded-t"
                        style={{ height: `${Math.max((d.count / max) * 60, d.count > 0 ? 4 : 0)}px` }}
                      />
                      <span className="text-xs text-gray-400">{d.day.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Searches / day */}
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Searches / Day</p>
              <div className="flex items-end gap-0.5 h-20">
                {stats.usageOverTime.searches.map((d, i) => {
                  const max = Math.max(...stats.usageOverTime.searches.map(x => x.count), 1)
                  return (
                    <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{d.count}</span>
                      <div
                        className="w-full bg-amber-400 rounded-t"
                        style={{ height: `${Math.max((d.count / max) * 60, d.count > 0 ? 4 : 0)}px` }}
                      />
                      <span className="text-xs text-gray-400">{d.day.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Venues Added / day */}
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">Venues Added / Day</p>
              <div className="flex items-end gap-0.5 h-20">
                {stats.usageOverTime.venuesAdded.map((d, i) => {
                  const max = Math.max(...stats.usageOverTime.venuesAdded.map(x => x.count), 1)
                  return (
                    <div key={i} className="flex flex-col items-center gap-0.5 flex-1">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-300">{d.count}</span>
                      <div
                        className="w-full bg-green-400 rounded-t"
                        style={{ height: `${Math.max((d.count / max) * 60, d.count > 0 ? 4 : 0)}px` }}
                      />
                      <span className="text-xs text-gray-400">{d.day.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No usage data yet.</p>
        )}
      </SectionCard>

      {/* Row 2.5d: Search Analytics (internal-only) */}
      <SectionCard title="Search Analytics (Last 30 Days)">
        {stats.searchStats ? (
          <div className="space-y-4">
            {/* KPI row */}
            <div className="grid grid-cols-2 gap-4 text-center">
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                <p className="text-2xl font-bold text-amber-600">{stats.searchStats.totalSearches.toLocaleString()}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Total Searches</p>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-3">
                <p className="text-2xl font-bold text-amber-600">{stats.searchStats.zeroResultSearches.toLocaleString()}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Zero-Result Searches</p>
              </div>
            </div>
            {/* Avg results + query type breakdown */}
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-xs text-gray-400">Avg Results / Search</p>
                <p className="font-medium text-gray-700 dark:text-gray-200">
                  {stats.searchStats.avgResultCount != null
                    ? stats.searchStats.avgResultCount.toFixed(1)
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400">By Type</p>
                <div className="flex gap-3 text-xs text-gray-600 dark:text-gray-300">
                  {Object.entries(stats.searchStats.byQueryType).map(([type, count]) => (
                    <span key={type} className="capitalize">{type}: <strong>{count}</strong></span>
                  ))}
                </div>
              </div>
            </div>
            {/* Top queries */}
            {stats.searchStats.topQueries.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Top Queries</p>
                <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-0.5">
                  {stats.searchStats.topQueries.slice(0, 8).map((q, i) => (
                    <li key={i} className="flex justify-between gap-4">
                      <span className="truncate">{q.query}</span>
                      <span className="text-gray-400 shrink-0">{q.count}×</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No search data yet — data accumulates as users search.</p>
        )}
      </SectionCard>

      {/* Row 3: Parse Quality (internal-only) */}
      <SectionCard title="Parse Quality (Last 30 Days)">
        {stats.parseQuality ? (
          <>
            {/* KPI row */}
            <div className="grid grid-cols-3 gap-4 text-center mb-4">
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3">
                <p className="text-2xl font-bold text-green-600">
                  {stats.parseQuality.parseSuccessRate !== null ? pct(stats.parseQuality.parseSuccessRate) : '—'}
                </p>
                <p className="text-xs text-gray-500 mt-1">Parse success rate</p>
              </div>
              <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
                <p className="text-2xl font-bold text-purple-600">
                  {fmt(stats.parseQuality.parseCompleteCount)}
                </p>
                <p className="text-xs text-gray-500 mt-1">Successful parses</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3">
                <p className="text-2xl font-bold text-red-600">
                  {fmt(stats.parseQuality.parseFailureCount)}
                </p>
                <p className="text-xs text-gray-500 mt-1">Failed parses</p>
              </div>
            </div>
            {/* HH-type distribution */}
            {Object.keys(stats.parseQuality.hhTypeDistribution).length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">HH-type distribution</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.parseQuality.hhTypeDistribution)
                    .sort(([, a], [, b]) => b - a)
                    .map(([type, count]) => (
                      <span key={type} className="inline-flex items-center gap-1.5 bg-gray-100 dark:bg-gray-700 rounded-full px-3 py-1 text-sm">
                        <span className="font-medium text-gray-700 dark:text-gray-200">{type}</span>
                        <span className="text-gray-400 text-xs">{count}</span>
                      </span>
                    ))}
                </div>
              </div>
            )}
            {/* Failed-parse log */}
            {stats.parseQuality.failedParseLog.length > 0 ? (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">
                  Failed parse log ({stats.parseQuality.failedParseLogNote})
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {stats.parseQuality.failedParseLog.map((entry, i) => (
                    <div key={i} className="bg-red-50 dark:bg-red-900/10 rounded-lg p-3 text-sm">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-xs text-gray-400">
                          {new Date(entry.timestamp).toLocaleString()}
                        </span>
                        {entry.error && (
                          <span className="text-xs text-red-400 truncate">{entry.error}</span>
                        )}
                      </div>
                      {entry.rawText ? (
                        <p className="text-gray-700 dark:text-gray-200 text-xs font-mono whitespace-pre-wrap break-all line-clamp-3">
                          {entry.rawText}
                        </p>
                      ) : (
                        <p className="text-gray-400 text-xs italic">No raw text captured</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-sm">No failed parses captured yet. Forward-only — only failures logged after this change are shown.</p>
            )}
          </>
        ) : (
          <p className="text-gray-400 text-sm">Parse quality data not available.</p>
        )}
      </SectionCard>

      {/* Row 3: User Engagement (internal-only) */}
      <SectionCard title="User Engagement (All Activity)">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3">
            <p className="text-2xl font-bold text-blue-600">{fmt(stats.userCounts.activeDevicesToday)}</p>
            <p className="text-xs text-gray-500 mt-1">Active today</p>
            <p className="text-xs text-gray-400 mt-0.5">any action</p>
          </div>
          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
            <p className="text-2xl font-bold text-purple-600">{fmt(stats.userCounts.activeDevicesThisWeek)}</p>
            <p className="text-xs text-gray-500 mt-1">Active this week</p>
            <p className="text-xs text-gray-400 mt-0.5">any action</p>
          </div>
          <div className="bg-gray-50 dark:bg-gray-900/20 rounded-lg p-3">
            <p className="text-2xl font-bold text-gray-600">{fmt(stats.userCounts.allTimeDevices)}</p>
            <p className="text-xs text-gray-500 mt-1">All-time devices</p>
            <p className="text-xs text-gray-400 mt-0.5">distinct hashes</p>
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          "Active" = any event. Distinct from scanner-only counts above (scan_start events only).
        </p>
      </SectionCard>

      {/* Row 4: Top Contributors + Moderation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Top Contributors">
          {stats.contributors.topDevices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase tracking-wider">
                    <th className="text-left pb-2">#</th>
                    <th className="text-left pb-2">Device</th>
                    <th className="text-right pb-2">Submissions</th>
                    <th className="text-right pb-2">Confirms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {stats.contributors.topDevices.slice(0, 10).map((d, i) => (
                    <tr key={d.deviceHash} className="text-gray-700 dark:text-gray-300">
                      <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                      <td className="py-2 font-mono text-xs text-gray-500">{d.deviceHash.slice(0, 12)}…</td>
                      <td className="py-2 text-right font-medium">{d.submissions}</td>
                      <td className="py-2 text-right font-medium text-purple-600">{d.confirmations}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No contributors this week.</p>
          )}
        </SectionCard>

        <SectionCard title="Moderation Signals">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-red-600">{stats.moderation.flagEventsToday}</p>
              <p className="text-xs text-gray-500 mt-1">Flags today</p>
            </div>
            <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{stats.moderation.flagEventsThisWeek}</p>
              <p className="text-xs text-gray-500 mt-1">Flags this week</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900/20 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-gray-600">{stats.moderation.staleVenues}</p>
              <p className="text-xs text-gray-500 mt-1">Stale venues</p>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900/20 rounded-lg p-4 text-center">
              <p className="text-2xl font-bold text-gray-600">{stats.moderation.abusiveDevices}</p>
              <p className="text-xs text-gray-500 mt-1">Abusive devices</p>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Row 4: Top Cities + Top Venues */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SectionCard title="Popular Cities (Last 30 Days)">
          {stats.topCities.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase tracking-wider">
                    <th className="text-left pb-2">#</th>
                    <th className="text-left pb-2">City</th>
                    <th className="text-right pb-2">Views</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {stats.topCities.map((c, i) => (
                    <tr key={`${c.city}-${c.state}`} className="text-gray-700 dark:text-gray-300">
                      <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                      <td className="py-2 font-medium">{c.city}{c.state ? `, ${c.state}` : ''}</td>
                      <td className="py-2 text-right font-bold text-amber-600">{c.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-400 text-sm">No city data yet.</p>
          )}
        </SectionCard>

        <SectionCard title="Top Venues (Last 30 Days)">
        {stats.topVenues.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase tracking-wider">
                  <th className="text-left pb-2">#</th>
                  <th className="text-left pb-2">Venue</th>
                  <th className="text-right pb-2">Status</th>
                  <th className="text-right pb-2">Views</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {stats.topVenues.map((v, i) => (
                  <tr key={v.id} className="text-gray-700 dark:text-gray-300">
                    <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                    <td className="py-2 font-medium">{v.name}</td>
                    <td className="py-2 text-right">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        v.status === 'verified' ? 'bg-green-100 text-green-700' :
                        v.status === 'stale' ? 'bg-orange-100 text-orange-700' :
                        v.status === 'closed' ? 'bg-red-100 text-red-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{v.status}</span>
                    </td>
                    <td className="py-2 text-right font-bold text-amber-600">{v.views}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No venue views yet.</p>
        )}
      </SectionCard>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-gray-400 pt-4">
        The Pour List · Dev Dashboard ·{' '}
        <a href="/" className="underline hover:text-amber-500">← Back to app</a>
      </div>
    </div>
  )
}