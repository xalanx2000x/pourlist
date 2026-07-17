'use client'

import { useState, useEffect } from 'react'
import { hasActiveHappyHour, resolveHH } from '@/lib/hh-state'
import { getCityCloseMin } from '@/lib/bar-close-times'
import type { Venue } from '@/lib/supabase'
import ShareButton from '@/components/ShareButton'

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
  /** Title used by the share button (rendered in the card header). */
  shareTitle?: string
  /** Body text used by the share button. */
  shareText?: string
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

// ── Icons (inline SVG, no deps) ───────────────────────────────────────────────

function LiveDot({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="currentColor" />
    </svg>
  )
}

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 16 14" />
    </svg>
  )
}

function PinIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" />
    </svg>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function VenueRow({
  venue,
  href,
  label,
  accent,
}: {
  venue: { name: string; neighborhood?: string | null }
  href: string
  label?: string
  accent: 'live' | 'soon'
}) {
  const pillClass =
    accent === 'live'
      ? 'bg-purple-100 text-purple-700'
      : 'bg-orange-100 text-orange-700'

  return (
    <a
      href={href}
      className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors group"
    >
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold text-gray-900 group-hover:text-amber-700 truncate">
          {venue.name}
        </div>
        {venue.neighborhood && (
          <div className="text-xs text-gray-500 mt-0.5 truncate">{venue.neighborhood}</div>
        )}
      </div>
      {label && (
        <span
          className={`shrink-0 text-xs font-medium px-3 py-1 rounded-full whitespace-nowrap ${pillClass}`}
        >
          {label}
        </span>
      )}
    </a>
  )
}

function SectionHeader({
  icon,
  title,
  count,
  accent,
}: {
  icon: React.ReactNode
  title: string
  count: number
  accent: 'live' | 'soon' | 'neighborhood'
}) {
  const labelClass =
    accent === 'live'
      ? 'text-purple-700'
      : accent === 'soon'
        ? 'text-orange-700'
        : 'text-orange-700'
  const badgeClass =
    accent === 'live'
      ? 'bg-purple-100 text-purple-700'
      : 'bg-orange-100 text-orange-700'

  return (
    <div className="flex items-center gap-2.5 px-5 pt-6 pb-3">
      <span className={labelClass}>{icon}</span>
      <h2 className={`text-xs font-bold uppercase tracking-widest ${labelClass}`}>{title}</h2>
      <span
        className={`text-xs font-bold px-2 py-0.5 rounded-full ${badgeClass}`}
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
  shareTitle,
  shareText,
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

  // Derive display name + state code for the hero label.
  // citySlug may be lowercase like "portland"; the page passes "Portland" via heading.
  // heading is "{cityName} Happy Hours", so we can reuse cityName = heading.replace(/\s+Happy Hours$/i, '').
  const cityName = heading.replace(/\s+Happy Hours$/i, '')
  const stateCode = state.toUpperCase()
  const heroLabel = `${cityName.toUpperCase()}, ${stateCode}`

  // Hero inner content — purple dot when live, orange dot otherwise.
  // Content/copy preserved exactly from prior pass.
  const heroContent = (() => {
    if (live.length > 0) {
      const plural = live.length !== 1 ? 's' : ''
      return (
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 leading-tight">
          <span className="text-purple-600">{live.length}</span>{' '}
          happy hour{plural} on now
          <LiveDot className="inline-block w-4 h-4 md:w-5 md:h-5 text-purple-600 ml-2 -mb-1" />
        </h1>
      )
    }
    if (comingUp.length > 0) {
      const first = resolveHH(comingUp[0], now)
      const mins = Math.round((first.opensAt!.getTime() - now.getTime()) / 60_000)
      if (mins <= 60 && mins > 0) {
        return (
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 leading-tight">
            <span className="text-orange-600">{mins}</span> min away at{' '}
            {comingUp[0].name}
            <ClockIcon className="inline-block w-5 h-5 md:w-6 md:h-6 text-orange-600 ml-2 -mb-1" />
          </h1>
        )
      }
      return (
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 leading-tight">
          <span className="text-orange-600">
            Next at {formatHeroTime(first.opensAt!, comingUp[0].timezone, now)}
          </span>{' '}
          at {comingUp[0].name}
          <ClockIcon className="inline-block w-5 h-5 md:w-6 md:h-6 text-orange-600 ml-2 -mb-1" />
        </h1>
      )
    }
    return (
      <h1 className="text-3xl md:text-4xl font-semibold text-gray-700 leading-tight">
        <span className="text-orange-600">No happy hours in horizon</span> — check back later
      </h1>
    )
  })()

  return (
    <div className="relative min-h-screen">
      {/*
        Backdrop layer. Sits behind the card. Clicking it opens the live map at /.
        Background-color placeholder (bg-amber-300 = #ffd236) renders visibly when
        neither backdrop file loads. Mobile uses the portrait file (vertical aspect
        ratio); desktop will use the horizontal file when Tyler drops it in.
        `absolute` (not `fixed`) so it scrolls with the page.
        Edge-tap accidents possible; iterate if reported.
      */}
      <a
        href="/"
        aria-label="Open live map"
        className="absolute inset-0 z-0 bg-amber-300 bg-[url(/portland-backdrop-portrait.png)] bg-cover bg-center bg-no-repeat md:bg-[url(/portland-backdrop.jpg)]"
      />

      <main className="relative z-10 min-h-screen flex justify-center p-6 md:p-12 pointer-events-none">
        <article className="pointer-events-auto w-full max-w-[600px] bg-white rounded-2xl shadow-xl overflow-hidden">
          {/* Card header strip — share button (city + neighborhood pages have no back-link) */}
          {shareTitle && (
            <div className="flex justify-end px-4 py-3 border-b border-gray-100">
              <ShareButton variant="labeled" title={shareTitle} text={shareText ?? shareTitle} />
            </div>
          )}
          {/* Hero */}
          <header className="px-6 pt-8 pb-6 border-b border-gray-100">
            <p className="text-xs uppercase tracking-widest text-gray-500 mb-4 font-medium">
              {heroLabel}
            </p>
            {heroContent}
            <p className="text-sm text-gray-500 mt-4">
              {allVenues.length} venue{allVenues.length !== 1 ? 's' : ''} with happy hours
            </p>
          </header>

          {/* Live Now */}
          {live.length > 0 && (
            <section>
              <SectionHeader
                icon={<LiveDot className="w-3.5 h-3.5" />}
                title="Live Now"
                count={live.length}
                accent="live"
              />
              <div>
                {live.map(v => {
                  const { closesAt } = resolveHH(v, now)
                  const label =
                    closesAt === null ? 'Until close' : `Until ${formatTime(closesAt, v.timezone)}`
                  return (
                    <VenueRow
                      key={v.id}
                      venue={{ name: v.name, neighborhood: v.neighborhood }}
                      href={`/${state}/${citySlug}/${v.new_slug?.split('/').pop()}`}
                      label={label}
                      accent="live"
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Coming Up */}
          {comingUp.length > 0 && (
            <section>
              <SectionHeader
                icon={<ClockIcon className="w-4 h-4" />}
                title="Coming Up"
                count={comingUp.length}
                accent="soon"
              />
              <div>
                {comingUp.map(v => {
                  const { opensAt } = resolveHH(v, now)
                  return (
                    <VenueRow
                      key={v.id}
                      venue={{ name: v.name, neighborhood: v.neighborhood }}
                      href={`/${state}/${citySlug}/${v.new_slug?.split('/').pop()}`}
                      label={opensAt ? formatComingUpBadge(opensAt, v.timezone, now) : ''}
                      accent="soon"
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Neighborhood links */}
          {qualifyingNeighborhoods.length > 0 && (
            <section>
              <SectionHeader
                icon={<PinIcon className="w-4 h-4" />}
                title="Browse by Neighborhood"
                count={qualifyingNeighborhoods.length}
                accent="neighborhood"
              />
              <div className="px-5 pb-6 flex flex-wrap gap-2">
                {qualifyingNeighborhoods.map(n => (
                  <a
                    key={n.slug}
                    href={`/${state}/${citySlug}/${n.slug}`}
                    className="text-sm border border-orange-300 text-orange-700 hover:bg-orange-50 px-3 py-1.5 rounded-full transition-colors"
                  >
                    {n.name} <span className="text-orange-400">({n.count})</span>
                  </a>
                ))}
              </div>
            </section>
          )}

          <div className="text-center text-xs text-gray-400 py-5 border-t border-gray-100">
            Powered by PourList ·{' '}
            <a href="/" className="underline hover:text-amber-600">
              Browse all cities
            </a>
          </div>
        </article>
      </main>
    </div>
  )
}