'use client'
/**
 * VenueLiveBadge — "use client" component.
 *
 * Computes the live "HH is active right now" state from the current time.
 * This component MUST NOT run on the server — we don't want Google caching
 * "LIVE NOW" into a static HTML page. The static page shows the schedule;
 * this badge shows the live/now state after client hydration.
 */
import { useEffect, useState } from 'react'
import type { Venue } from '@/lib/supabase'
import { hasActiveHappyHour } from '@/lib/activeHH'

interface VenueLiveBadgeProps {
  venue: Venue
}

/** Re-render every 60 seconds so the badge reflects time-of-day changes. */
export default function VenueLiveBadge({ venue }: VenueLiveBadgeProps) {
  const [active, setActive] = useState(false)

  useEffect(() => {
    setActive(hasActiveHappyHour(venue))
    const interval = setInterval(() => {
      setActive(hasActiveHappyHour(venue))
    }, 60_000)
    return () => clearInterval(interval)
  }, [venue])

  if (!active) return null

  return (
    <span className="inline-flex items-center gap-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">
      HH Active
    </span>
  )
}
