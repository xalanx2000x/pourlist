'use client'

import { useState, useEffect } from 'react'
import { hasActiveHappyHour, resolveHH } from '@/lib/activeHH'
import type { Venue } from '@/lib/supabase'

export interface LeanVenueForHH {
  id: string
  name: string
  neighborhood: string | null
  hh_type: string | null
  hh_time: string | null
  hh_days: string | null
  hh_exclude_days: string | null
  hh_start: number | null
  hh_end: number | null
  hh_type_2: string | null
  hh_days_2: string | null
  hh_exclude_days_2: string | null
  hh_start_2: number | null
  hh_end_2: number | null
  hh_type_3: string | null
  hh_days_3: string | null
  hh_exclude_days_3: string | null
  hh_start_3: number | null
  hh_end_3: number | null
  opening_min: number | null
  timezone: string | null
  new_slug: string | null
  address: string | null
  lat: number | null
  lng: number | null
}

interface QualifyingNeighborhood {
  name: string
  slug: string
  count: number
}

interface Props {
  heading: string
  subheading: string
  state: string
  citySlug: string
  allVenues: LeanVenueForHH[]
  qualifyingNeighborhoods: QualifyingNeighborhood[]
}

const STARTING_SOON_WINDOW_MIN = 60 // 1 hour

/**
 * Returns true when the next HH window opens within STARTING_SOON_WINDOW_MIN minutes,
 * in the venue's own timezone. Falls back to Pacific when venue.timezone is null.
 */
function isStartingSoon(venue: LeanVenueForHH): boolean {
  if (hasActiveHappyHour(venue)) return false
  const res = resolveHH(venue)
  if (!res.opensAt) return false
  const now = new Date()
  const minutesUntil = Math.round((res.opensAt.getTime() - now.getTime()) / 60_000)
  return minutesUntil > 0 && minutesUntil <= STARTING_SOON_WINDOW_MIN
}

function formatHhTime(venue: LeanVenueForHH): string {
  if (venue.hh_time) return venue.hh_time
  if (venue.hh_start != null) {
    const h = Math.floor(venue.hh_start / 60)
    const m = venue.hh_start % 60
    const period = h < 12 ? 'AM' : 'PM'
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    const start = `${hour12}:${m.toString().padStart(2, '0')} ${period}`
    if (venue.hh_end != null) {
      const eh = Math.floor(venue.hh_end / 60)
      const em = venue.hh_end % 60
      const ePeriod = eh < 12 ? 'AM' : 'PM'
      const eHour12 = eh === 0 ? 12 : eh > 12 ? eh - 12 : eh
      return `${start} – ${eHour12}:${em.toString().padStart(2, '0')} ${ePeriod}`
    }
    return `${start}`
  }
  return 'Happy Hour'
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VenueRow({ venue, href, label }: { venue: { name: string; neighborhood?: string | null }; href: string; label?: string }) {
  return (
    <a
      href={href}
      className="flex items-center justify-between px-4 py-3 border-b border-gray-100 hover:bg-amber-50 transition-colors group"
    >
      <div>
        <span className="font-medium text-gray-900 group-hover:text-amber-700">{venue.name}</span>
        {venue.neighborhood && (
          <span className="ml-2 text-xs text-gray-400">{venue.neighborhood}</span>
        )}
      </div>
      {label && (
        <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
          {label}
        </span>
      )}
    </a>
  )
}

function SectionHeader({ title, count, accent }: { title: string; count: number; accent: 'live' | 'soon' }) {
  const colors = {
    live: 'text-purple-700 bg-purple-50 border-purple-200',
    soon: 'text-orange-700 bg-orange-50 border-orange-200',
    popular: 'text-gray-700 bg-gray-50 border-gray-200',
  }
  return (
    <div className={`flex items-center gap-3 px-4 py-2 border-t border-b ${colors[accent]}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
        accent === 'live' ? 'bg-purple-200 text-purple-800'
          : accent === 'soon' ? 'bg-orange-200 text-orange-800'
          : 'bg-gray-200 text-gray-600'
      }`}>{count}</span>
    </div>
  )
}

function EmptyState({ live, soon }: { live: number; soon: number }) {
  const bothEmpty = live === 0 && soon === 0
  if (!bothEmpty) return null
  return (
    <div className="px-4 py-6 text-center border-t border-gray-100">
      <p className="text-gray-500 text-sm mb-1">No happy hours are live right now.</p>
      <p className="text-gray-400 text-xs">Scroll down to see Portland's most popular happy hours below.</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CityPageClient({
  heading,
  subheading,
  state,
  citySlug,
  allVenues,
  qualifyingNeighborhoods,
}: Props) {
  const [tick, setTick] = useState(0) // force re-render every minute

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = tick // reference to trigger reactivity

  const liveRaw = allVenues.filter(v => hasActiveHappyHour(v))
  const soonRaw = allVenues.filter(v => isStartingSoon(v))

  // A2: runway sort — LIVE: latest-closes first (most runway on top), til-close (null) on top
  const live = [...liveRaw].sort((a, b) => {
    const ra = resolveHH(a), rb = resolveHH(b)
    if (ra.closesAt === null && rb.closesAt === null) return 0
    // til-close (null) sorts before any explicit close time
    if (ra.closesAt === null) return -1
    if (rb.closesAt === null) return 1
    return rb.closesAt.getTime() - ra.closesAt.getTime()
  })

  // A2: runway sort — SOON: earliest-opens first (starting-soonest on top)
  const soon = [...soonRaw].sort((a, b) => {
    const ra = resolveHH(a), rb = resolveHH(b)
    if (!ra.opensAt) return 1
    if (!rb.opensAt) return -1
    return ra.opensAt.getTime() - rb.opensAt.getTime()
  })

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-8 text-white">
        <p className="text-xs uppercase tracking-widest opacity-80 mb-1">{subheading}</p>
        <h1 className="text-3xl font-bold">{heading}</h1>
        {/* A4: answer-first — live count in hero */}
        {live.length > 0 ? (
          <p className="text-amber-100 text-sm mt-1">
            🟣 {live.length} happy hour{live.length !== 1 ? 's' : ''} on now
          </p>
        ) : soon.length > 0 ? (
          <p className="text-amber-100 text-sm mt-1">
            No happy hours live right now — {soon.length} starting soon
          </p>
        ) : (
          <p className="text-amber-100 text-sm mt-1 opacity-60">
            No live happy hours right now
          </p>
        )}
        <p className="text-amber-100 text-sm">
          {allVenues.length} venue{allVenues.length !== 1 ? 's' : ''} with happy hours
        </p>
      </div>

      {/* Live Now */}
      {live.length > 0 && (
        <section>
          <SectionHeader title="Live Right Now" count={live.length} accent="live" />
          <div className="divide-y divide-gray-100">
            {live.map(v => (
              <VenueRow
                key={v.id}
                venue={{ name: v.name, neighborhood: v.neighborhood }}
                href={`/${state}/${citySlug}/${v.new_slug?.split('/').pop()}`}
                label={`Until ${formatHhTime(v).split(' – ').pop()}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Starting Soon */}
      {soon.length > 0 && (
        <section>
          <SectionHeader title="Starting Soon" count={soon.length} accent="soon" />
          <div className="divide-y divide-gray-100">
            {soon.map(v => (
              <VenueRow
                key={v.id}
                venue={{ name: v.name, neighborhood: v.neighborhood }}
                href={`/${state}/${citySlug}/${v.new_slug?.split('/').pop()}`}
                label={`Starts ${formatHhTime(v).split(' – ')[0]}`}
              />
            ))}
          </div>
        </section>
      )}

      {/* Empty state when no live + no soon */}
      <EmptyState live={live.length} soon={soon.length} />

      {/* Neighborhood links — auto-appears when ≥1 neighborhood qualifies */}
      {qualifyingNeighborhoods.length > 0 && (
        <section className="px-6 py-4 border-t border-gray-100">
          <h3 className="text-xs uppercase tracking-widest text-gray-400 mb-3">
            Browse by Neighborhood
          </h3>
          <div className="flex flex-wrap gap-2">
            {qualifyingNeighborhoods.map(n => (
              <a
                key={n.slug}
                href={`/${state}/${citySlug}/${n.slug}`}
                className="text-sm bg-gray-100 hover:bg-amber-100 text-gray-700 hover:text-amber-800 px-3 py-1.5 rounded-full transition-colors"
              >
                {n.name} <span className="text-gray-400">({n.count})</span>
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="text-center text-xs text-gray-400 py-6 border-t border-gray-100">
        Powered by PourList ·{' '}
        <a href="/" className="underline hover:text-amber-600">Browse all cities</a>
      </div>
    </div>
  )
}
