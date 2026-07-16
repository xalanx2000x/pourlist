'use client'

import type { LeanVenue } from '@/lib/venues'
import type { Venue } from '@/lib/supabase'
import VenueCard from './VenueCard'
import { hasActiveHappyHour } from '@/lib/hh-state'

interface VenueListProps {
  venues: LeanVenue[]
  mapBounds: { north: number; south: number; east: number; west: number } | null
  areaName: string | null
  selectedVenue: Venue | null
  onVenueSelect: (venue: LeanVenue) => void
  /** True when the venue fetch hit the 150-row cap — there are more
   *  venues in the viewport that didn't make the cut. The header
   *  surfaces a "showing top N — zoom in for more" hint. */
  capped?: boolean
}

export default function VenueList({ venues, mapBounds, areaName, selectedVenue, onVenueSelect, capped }: VenueListProps) {
  const activeHHCount = venues.filter(v => hasActiveHappyHour(v)).length

  if (venues.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-center">
        <div>
          <p className="text-gray-500 mb-2">No venues found in this area.</p>
          <p className="text-sm text-gray-400">Be the first to add one!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-2 text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
        {venues.length} venue{venues.length !== 1 ? 's' : ''}
        {areaName ? ` in ${areaName}` : ' nearby'}
        {mapBounds && (
          <span className="ml-1 text-gray-400">· swipe map for full list</span>
        )}
        {capped && (
          <span className="ml-2 text-amber-600 font-semibold">· showing top {venues.length}, zoom in for more</span>
        )}
        {activeHHCount > 0 && (
          <span className="ml-2 text-purple-600 font-semibold">· {activeHHCount} with active HH</span>
        )}
      </div>
      {venues.map(venue => (
        <VenueCard
          key={venue.id}
          venue={venue}
          isSelected={selectedVenue?.id === venue.id}
          onClick={() => onVenueSelect(venue)}
        />
      ))}
    </div>
  )
}
