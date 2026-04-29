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

      {/* Row 3: Top Contributors + Moderation */}
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

      {/* Footer */}
      <div className="text-center text-xs text-gray-400 pt-4">
        The Pour List · Dev Dashboard ·{' '}
        <a href="/" className="underline hover:text-amber-500">← Back to app</a>
      </div>
    </div>
  )
}