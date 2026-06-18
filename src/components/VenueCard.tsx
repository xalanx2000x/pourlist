'use client'

import type { Venue } from '@/lib/supabase'
import { hasActiveHappyHour } from '@/lib/activeHH'
import { getHHState, getHHColor } from '@/lib/hh-state'
import ShareButton from './ShareButton'
import { formatAddress } from '@/lib/format-address'

interface VenueCardProps {
  venue: Venue
  isSelected: boolean
  onClick: () => void
}

export default function VenueCard({ venue, isSelected, onClick }: VenueCardProps) {
  const isActiveHH = hasActiveHappyHour(venue)
  const hhState = getHHState(venue)
  const hhColor = getHHColor(hhState)

  // Keyboard a11y: outer is a <div role="button">, so handle Enter/Space
  // explicitly. Without this, keyboard users can't open the card.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onClick()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      aria-pressed={isSelected}
      aria-label={`Open ${venue.name}`}
      className={`w-full text-left p-4 border-b border-gray-100 transition-colors cursor-pointer focus:outline-none focus-visible:bg-amber-50 ${
        isSelected ? 'bg-amber-50 border-l-4 border-l-amber-500' : 'hover:bg-gray-50 border-l-4'
      }`}
      style={{ borderLeftColor: isSelected ? undefined : hhColor }}
    >
      <div className="flex justify-between items-start gap-2 relative">
        {venue.latest_menu_image_url && (
          <span className="absolute top-0 right-0 text-sm text-gray-400 pointer-events-none">📷</span>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{venue.name}</h3>
          {venue.hh_time && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full mt-0.5 inline-block">
              {venue.hh_time}
            </span>
          )}
          <p className="text-sm text-gray-600 mt-0.5">{formatAddress(venue)}</p>
          {venue.type && (
            <span className="inline-block mt-1.5 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {venue.type}
            </span>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1">
          {/* Share — 44×44px tap target, stopPropagation handled inside */}
          <ShareButton venue={venue} />
          {isActiveHH && (
            <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-semibold">
              HH Active
            </span>
          )}
          {venue.status === 'unverified' && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
              New
            </span>
          )}
          {venue.status === 'stale' && (
            <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
              Needs Update
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
