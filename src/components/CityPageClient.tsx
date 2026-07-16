'use client'

import { useState, useEffect } from 'react'
import { hasActiveHappyHour, resolveHH } from '@/lib/hh-state'
import { getCityCloseMin } from '@/lib/bar-close-times'
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute the end-of-current-PourList-day for a venue, in that venue's timezone.
 * The PourList day runs from opening_min to getCityCloseMin(city, state) today.
 * If `now` is already past today's close, rolls to tomorrow's close.
 * Returns a browser-local Date.
 */
function endOfPourListDay(venue: LeanVenueForHH, now: Date): Date {
  const tz = venue.timezone ?? 'America/Los_Angeles'
  // Portland is the only city in scope for this fix; getCityCloseMin is keyed on city+state
  const closeMin = getCityCloseMin('Portland', 'OR')

  const dParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const y = +dParts.find(p => p.type === 'year')!.value
  const mo = +dParts.find(p => p.type === 'month')!.value - 1
  const day = +dParts.find(p => p.type === 'day')!.value

  // UTC midnight of "today" in venue timezone
  const utcMidnight = Date.UTC(y, mo, day, 0, 0, 0, 0)
  // UTC time of today's close
  const utcClose = utcMidnight + closeMin * 60_000

  // Determine the timezone offset at that UTC moment (returns GMT±H as string)
  const offsetRaw = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'short',
  }).formatToParts(new Date(utcClose)).find(p => p.type === 'timeZoneName')?.value ?? ''
  const match = offsetRaw.match(/GMT([+-])(\d+)/)
  const sign = match ? (match[1] === '+' ? 1 : -1) : 0
  const hrs = match ? +match[2] : 0

  // Convert UTC close → browser-local
  const localClose = new Date(utcClose - sign * hrs * 3_600_000)

  // If now is already past today's close, roll to tomorrow
  if (now >= localClose) {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(tomorrow)
    const ty = +tParts.find(p => p.type === 'year')!.value
    const tmo = +tParts.find(p => p.type === 'month')!.value - 1
    const tday = +tParts.find(p => p.type === 'day')!.value
    const tUtcMidnight = Date.UTC(ty, tmo, tday, 0, 0, 0, 0)
    const tUtcClose = tUtcMidnight + closeMin * 60_000
    return new Date(tUtcClose - sign * hrs * 3_600_000)
  }

  return localClose
}

/**
 * Badge for Coming Up rows — three formats:
 *   ≤60 min away         → "Starts in N min"
 *   same calendar day    → "Starts H:MM AM/PM"
 *   later day            → "Starts Day H:MM AM/PM"
 * All times in venue.timezone.
 */
function formatComingUpBadge(opensAt: Date, timezone: string | null, now: Date): string {
  const minutesUntil = Math.round((opensAt.getTime() - now.getTime()) / 60_000)

  if (minutesUntil <= 60 && minutesUntil > 0) {
    return `Starts in ${minutesUntil} min`
  }

  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: timezone ?? undefined, ...opts }).format(opensAt)

  const dayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone ?? undefined,
    weekday: 'short',
  })
  const daySame = dayFmt.format(opensAt) === dayFmt.format(now)
  const timeStr = fmt({ hour: 'numeric', minute: '2-digit', hour12: true })

  if (daySame) return `Starts ${timeStr}`
  return `Starts ${fmt({ weekday: 'short' })} ${timeStr}`
}

/**
 * Format a time for the hero "Next at" line.
 * Same calendar day → "2:00 PM"
 * Later day         → "Fri 2:00 PM"
 * All times in venue.timezone.
 */
function formatHeroTime(opensAt: Date, timezone: string | null, now: Date): string {
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: timezone ?? undefined, ...opts }).format(opensAt)
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone ?? undefined, weekday: 'short' })
  const daySame = dayFmt.format(opensAt) === dayFmt.format(now)
  const timeStr = fmt({ hour: 'numeric', minute: '2-digit', hour12: true })
  if (daySame) return timeStr
  return `${fmt({ weekday: 'short' })} ${timeStr}`
}

/**
 * Format a Date as "H:MM AM/PM" in the venue's timezone.
 * Falls back to local browser time when venue.timezone is null.
 */
function formatTime(date: Date, timezone: string | null): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone ?? undefined,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VenueRow({
  venue,
  href,
  label,
}: {
  venue: { name: string; neighborhood?: string | null }
  href: string
  label?: string
}) {
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

function SectionHeader({
  title,
  count,
  accent,
}: {
  title: string
  count: number
  accent: 'live' | 'soon'
}) {
  const colors = {
    live: 'text-purple-700 bg-purple-50 border-purple-200',
    soon: 'text-orange-700 bg-orange-50 border-orange-200',
    popular: 'text-gray-700 bg-gray-50 border-gray-200',
  }
  return (
    <div className={`flex items-center gap-3 px-4 py-2 border-t border-b ${colors[accent]}`}>
      <h2 className="text-base font-semibold">{title}</h2>
      <span
        className={`text-xs font-bold px-2 py-0.5 rounded-full ${
          accent === 'live'
            ? 'bg-purple-200 text-purple-800'
            : accent === 'soon'
              ? 'bg-orange-200 text-orange-800'
              : 'bg-gray-200 text-gray-600'
        }`}
      >
        {count}
      </span>
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

  const now = new Date()
  const liveRaw = allVenues.filter(v => hasActiveHappyHour(v, now))

  // A2: runway sort — LIVE: latest-closes first (most runway on top), til-close (null) on top
  const live = [...liveRaw].sort((a, b) => {
    const ra = resolveHH(a, now),
      rb = resolveHH(b, now)
    if (ra.closesAt === null && rb.closesAt === null) return 0
    if (ra.closesAt === null) return -1
    if (rb.closesAt === null) return 1
    return rb.closesAt.getTime() - ra.closesAt.getTime()
  })

  // Coming Up: non-live venues with opensAt within today's PourList horizon, sorted soonest-first
  const comingUp = allVenues
    .filter(v => {
      if (hasActiveHappyHour(v, now)) return false
      const res = resolveHH(v, now)
      if (!res.opensAt) return false
      const horizon = endOfPourListDay(v, now)
      return res.opensAt <= horizon
    })
    .sort((a, b) => {
      const ra = resolveHH(a, now),
        rb = resolveHH(b, now)
      const aTime = ra.opensAt?.getTime() ?? Infinity
      const bTime = rb.opensAt?.getTime() ?? Infinity
      if (aTime !== bTime) return aTime - bTime
      return (a.name ?? '').localeCompare(b.name ?? '')
    })

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-8 text-white">
        <p className="text-xs uppercase tracking-widest opacity-80 mb-1">{subheading}</p>
        <h1 className="text-3xl font-bold">{heading}</h1>

        {/* Hero — adapts to top of the list */}
        {live.length > 0 ? (
          <p className="text-amber-100 text-sm mt-1">
            🟣 {live.length} happy hour{live.length !== 1 ? 's' : ''} on now
          </p>
        ) : comingUp.length > 0 ? (() => {
          const first = resolveHH(comingUp[0], now)
          const mins = Math.round((first.opensAt!.getTime() - now.getTime()) / 60_000)
          return mins <= 60 && mins > 0 ? (
            <p className="text-amber-100 text-sm mt-1">
              🍊 Starts in {mins} min at {comingUp[0].name}
            </p>
          ) : (
            <p className="text-amber-100 text-sm mt-1">
              🍊 Next at {formatHeroTime(first.opensAt!, comingUp[0].timezone, now)} at{' '}
              {comingUp[0].name}
            </p>
          )
        })() : (
          <p className="text-amber-100 text-sm mt-1 opacity-80">
            🍊 No happy hours in horizon — check back later
          </p>
        )}

        <p className="text-amber-100 text-sm">
          {allVenues.length} venue{allVenues.length !== 1 ? 's' : ''} with happy hours
        </p>
      </div>

      {/* Live Now */}
      {live.length > 0 && (
        <section>
          <SectionHeader title="Live Now" count={live.length} accent="live" />
          <div className="divide-y divide-gray-100">
            {live.map(v => {
              const { closesAt } = resolveHH(v, now)
              const label = closesAt === null ? 'Until close' : `Until ${formatTime(closesAt, v.timezone)}`
              return (
                <VenueRow
                  key={v.id}
                  venue={{ name: v.name, neighborhood: v.neighborhood }}
                  href={`/${state}/${citySlug}/${v.new_slug?.split('/').pop()}`}
                  label={label}
                />
              )
            })}
          </div>
        </section>
      )}

      {/* Coming Up */}
      {comingUp.length > 0 && (
        <section>
          <SectionHeader title="Coming Up" count={comingUp.length} accent="soon" />
          <div className="divide-y divide-gray-100">
            {comingUp.map(v => {
              const { opensAt } = resolveHH(v, now)
              return (
                <VenueRow
                  key={v.id}
                  venue={{ name: v.name, neighborhood: v.neighborhood }}
                  href={`/${state}/${citySlug}/${v.new_slug?.split('/').pop()}`}
                  label={opensAt ? formatComingUpBadge(opensAt, v.timezone, now) : ''}
                />
              )
            })}
          </div>
        </section>
      )}

      {/* Neighborhood links */}
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
        <a href="/" className="underline hover:text-amber-600">
          Browse all cities
        </a>
      </div>
    </div>
  )
}
